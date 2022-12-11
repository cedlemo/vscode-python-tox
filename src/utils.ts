import * as vscode from 'vscode';
import * as path from 'path';

export function findProjectDir() {
	const docUri = vscode.window.activeTextEditor?.document.uri;
	if (!docUri) {
		throw new Error("No active editor found.");
	}
	const configuration = vscode.workspace.getConfiguration('tox');
	const workspaceFolder = vscode.workspace.getWorkspaceFolder(docUri);

	if (!workspaceFolder) {
		const docPath = docUri.fsPath;
		const docDir = path.dirname(docPath);
		console.log(`tox doc path: ${docPath} -> ${docDir}`);
		return docDir;
	}
	
	let folder = workspaceFolder.uri.fsPath;

	if(configuration.cwd) {
		let toxRootFolder = configuration.cwd.replace('${workspaceFolder}', workspaceFolder.uri.fsPath);
		toxRootFolder = configuration.cwd.replace('${fileWorkspaceFolder}', path.dirname(docUri.fsPath));
		
		if (!path.isAbsolute(toxRootFolder)) {
			folder = path.join(workspaceFolder.uri.fsPath, toxRootFolder);
		} else {
			folder = toxRootFolder;
		}
	}

	folder = path.normalize(folder);
	console.log(`tox workspace folder: ${folder}`);
	return folder;
}

/**
 * Get a new terminal or use an existing one with the same name.
 * @param projDir The directory of the project.
 * @param name The name of the terminal
 * @returns The terminal to run commands on.
 */
export function getTerminal(projDir : string = findProjectDir(), name : string = "tox") : vscode.Terminal {
	for (const terminal of vscode.window.terminals) {
		if (terminal.name === name){
			return terminal;
		}
	}
	return vscode.window.createTerminal({"cwd": projDir, "name": name});
}
