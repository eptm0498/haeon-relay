import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import * as modes from '../../lib/dokyeong/character-modes.ts';
import * as monologue from '../../lib/dokyeong/call-monologue.ts';
const exports = {};
vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL('../../lib/dokyeong/jiwoo-conversation-rules.ts', import.meta.url),'utf8'), {compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText, {
  exports, require: name => name === './character-modes' ? modes : monologue,
});
export default exports;
