// Production-container acceptance: render a reviewed sample without calling AI.
import {createRequire} from 'node:module';
import {readFileSync,mkdirSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
// Match the production video worker's working directory and browser cache.
process.chdir(resolve(root,'web'));
const require=createRequire(resolve(root,'web/package.json'));
const {bundle}=await import(pathToFileURL(require.resolve('@remotion/bundler')).href);
const {selectComposition,renderStill}=await import(pathToFileURL(require.resolve('@remotion/renderer')).href);
const sources=JSON.parse(readFileSync(resolve(root,'resources/codex/paper/lesson-sources.json'),'utf8'));
const motionPack=JSON.parse(readFileSync(resolve(root,'resources/codex/paper/q27-1.json'),'utf8'));
const part=sources.find(s=>s.question.number===27).lesson.parts.find(p=>p.partId==='1');
const folder=resolve(root,'data/runtime/deployment-smoke');
mkdirSync(folder,{recursive:true});
const serveUrl=await bundle({entryPoint:resolve(root,'web/src/remotion/entry.tsx'),rootDir:resolve(root,'web'),outDir:resolve(folder,'bundle')});
const inputProps={part,motionPack,pace:1,canvasOnly:false,reducedMotion:false};
const composition=await selectComposition({serveUrl,id:'Lesson',inputProps});
if(composition.width!==1280||composition.height!==720)throw new Error('Unexpected lesson export dimensions');
const output=resolve(folder,'q27.png');
await renderStill({composition,serveUrl,inputProps,frame:90,output,imageFormat:'png'});
const png=readFileSync(output);
if(png.readUInt32BE(16)!==1280||png.readUInt32BE(20)!==720)throw new Error('Invalid exported PNG');
console.log('Reviewed Q27 rendered successfully in the production container: 1280x720. No AI requests.');
