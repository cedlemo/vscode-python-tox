import * as vscode from 'vscode';
import * as child_process from 'child_process';
import * as util from 'util';
import * as path from 'path';
import * as os from 'os';

const exec = util.promisify(child_process.exec);

function findProjectDir() {
	const docUri = vscode.window.activeTextEditor?.document.uri;
	if (!docUri) {
		throw new Error("No active editor found.");
	}

	const workspace = vscode.workspace.getWorkspaceFolder(docUri);
	if (workspace) {
		const folder = workspace.uri.fsPath;
		console.log(`tox workspace folder: ${folder}`);
		return folder;
	}

	const docPath = docUri.fsPath;
	const docDir = path.dirname(docPath);
	console.log(`tox doc path: ${docPath} -> ${docDir}`);
	return docDir;
}

async function getToxEnvs(projDir: string) {
	const { stdout } = await exec('tox -a', {cwd: projDir});
	return stdout.trim().split(os.EOL);
}

async function safeGetToxEnvs(projDir: string) {
	try {
		return await getToxEnvs(projDir);
	} catch (error: any) {
		vscode.window.showErrorMessage(error.message);
		return;
	}
}

function runTox(envs: string[], projDir: string) {
	const term = vscode.window.createTerminal({"cwd": projDir, "name": "tox"});
	const envArg = envs.join(",");
	term.show(true);  // preserve focus

	// FIXME In theory, there's a command injection here, if an environment name
	// contains shell metacharacters. However:
	// - Escaping the argument in a shell-agnostic way is hard:
	//   https://github.com/microsoft/vscode/blob/1.57.0/src/vs/workbench/contrib/debug/node/terminals.ts#L84-L211
	// - The environment names are coming from the tox config via "tox -l", so
	//   if someone could configure a malicious environment, they could as well
	//   just tell tox to run malicious commands.
	// - We don't run on untrusted workspaces.
	// - The user actively picks the environment name to be run.
	// - Real tox environment names are very unlikely to accidentally contain
	//   such characters - in fact, using spaces in env names seems to not work
	//   properly at all.
	term.sendText(`tox -e ${envArg}`);
}

async function selectCommand() {
	const projDir = findProjectDir();
	const envs = await safeGetToxEnvs(projDir);
	if (!envs) {
		return;
	}
	const selected = await vscode.window.showQuickPick(envs, {placeHolder: "tox environment"});
	if (!selected) {
		return;
	}
	runTox([selected], projDir);
}

async function selectMultipleCommand() {
	const projDir = findProjectDir();
	const envs = await safeGetToxEnvs(projDir);
	if (!envs) {
		return;
	}
	const selected = await vscode.window.showQuickPick(envs, {placeHolder: "tox environments", canPickMany: true});
	if (!selected) {
		return;
	}
	runTox(selected, projDir);
}

export function activate(context: vscode.ExtensionContext) {
	const controller = vscode.tests.createTestController('toxTestController', 'Tox Testing');
	context.subscriptions.push(controller);

	controller.resolveHandler = async (test) => { 
		if (!test) {
			await discoverAllFilesInWorkspace();
		} 
		else {
			await parseTestsInFileContents(test);
		}
	};
	
	// When text documents are open, parse tests in them.
	vscode.workspace.onDidOpenTextDocument(parseTestsInDocument);
	
	// We could also listen to document changes to re-parse unsaved changes:
	vscode.workspace.onDidChangeTextDocument(e => parseTestsInDocument(e.document));

	/**
	 * In this function, we'll get the file TestItem if we've already found it,
	 * otherwise we'll create it with `canResolveChildren = true` to indicate it
	 * can be passed to the `controller.resolveHandler` to gets its children.
	 * @param uri	The uri of the file to get or create
	 * @returns vscode.TestItem
	 */
	function getOrCreateFile(uri: vscode.Uri) 
	{
		const existing = controller.items.get(uri.toString());
		if (existing) {
			return existing;
		}
	
		const file = controller.createTestItem(uri.toString(), uri.path.split('/').pop()!, uri);
		controller.items.add(file);

		file.canResolveChildren = true;
		return file;
	}

	/**
	 * Parses for tests in the document.
	 * @param e	The provided document
	 * @param filename	The name of the file to look for. Default = tox.ini
	 */
	function parseTestsInDocument(e: vscode.TextDocument, filename: string = 'tox.ini') {
		if (e.uri.scheme === 'file' && e.uri.path.endsWith(filename)) {
			parseTestsInFileContents(getOrCreateFile(e.uri), e.getText());
		}
	}

	/**
	 * Parses the file to fill in the test.children from the contents
	 * @param file The file to parse
	 * @param contents The contents of the file
	 */
	async function parseTestsInFileContents(file: vscode.TestItem, contents?: string) {
		
		// TODO: Make the new TestItem be under the existing one
		const newTestItem = controller.createTestItem("cowsay", "cowsay", file.uri);

		controller.items.add(newTestItem);
	}

	async function discoverAllFilesInWorkspace() {
		if (!vscode.workspace.workspaceFolders) {
			return []; // handle the case of no open folders
		}
		
		return Promise.all(
			vscode.workspace.workspaceFolders.map(async workspaceFolder => {
				const pattern = new vscode.RelativePattern(workspaceFolder, 'tox.ini');
				const watcher = vscode.workspace.createFileSystemWatcher(pattern);
			
				// When files are created, make sure there's a corresponding "file" node in the tree
				watcher.onDidCreate(uri => getOrCreateFile(uri));
				// When files change, re-parse them. Note that you could optimize this so
				// that you only re-parse children that have been resolved in the past.
				watcher.onDidChange(uri => parseTestsInFileContents(getOrCreateFile(uri)));
				// And, finally, delete TestItems for removed files. This is simple, since
				// we use the URI as the TestItem's ID.
				watcher.onDidDelete(uri => controller.items.delete(uri.toString()));
			
				for (const file of await vscode.workspace.findFiles(pattern)) {
					getOrCreateFile(file);
				}
			
				return watcher;
			})
		);
	}

	context.subscriptions.push(
		vscode.commands.registerCommand('python-tox.select', selectCommand),
		vscode.commands.registerCommand('python-tox.selectMultiple', selectMultipleCommand)
	);
}

export function deactivate() {}

// For testing, before we move this to a utils.ts
export const _private = {
	getToxEnvs,
	runTox,
};
