// Render only the application's reviewed, fixed Lesson composition.
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {dirname, join, resolve, basename} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {readFileSync, writeFileSync, renameSync, readdirSync, existsSync, mkdirSync, chmodSync, realpathSync} from 'node:fs';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const webRoot = join(projectRoot, 'web');
const videosRoot = join(projectRoot, 'data', 'runtime', 'videos');
const directory = resolve(process.argv[2] || '.');
if (dirname(directory) !== videosRoot || realpathSync(directory) !== directory
    || !/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(basename(directory))) {
  throw new Error('A private video UUID directory is required');
}
const writeProgress = (value) => {
  const path = join(directory, 'progress.json');
  writeFileSync(path + '.tmp', JSON.stringify(value), {mode: 0o600});
  renameSync(path + '.tmp', path);
};

let stage = 'bundling';
try {
  const request = JSON.parse(readFileSync(join(directory, 'snapshot.json'), 'utf8'));
  const {part, pace} = request.inputProps;
  if (!part || !Array.isArray(part.steps) || !part.steps.length || ![1, 2].includes(pace)) {
    throw new Error('Reviewed lesson snapshot required');
  }
  const inputProps = {part, pace, canvasOnly: false, reducedMotion: false};
  const require = createRequire(join(webRoot, 'package.json'));
  const {bundle} = await import(pathToFileURL(require.resolve('@remotion/bundler')).href);
  const {ensureBrowser, selectComposition, renderMedia} = await import(pathToFileURL(require.resolve('@remotion/renderer')).href);
  // Cache only the application bundle. Every MP4 still uses its own immutable lesson snapshot.
  const fingerprint = createHash('sha256');
  const hashFiles = (folder) => {
    for (const item of readdirSync(folder, {withFileTypes: true}).sort((a, b) => a.name.localeCompare(b.name))) {
      const path = join(folder, item.name);
      if (item.isDirectory()) hashFiles(path);
      else if (item.isFile()) fingerprint.update(path).update(readFileSync(path));
    }
  };
  hashFiles(join(webRoot, 'src'));
  hashFiles(join(webRoot, 'public'));
  fingerprint.update(readFileSync(join(webRoot, 'package-lock.json')));
  const bundleDirectory = join(videosRoot, '_bundles', fingerprint.digest('hex'));
  const marker = join(bundleDirectory, '.complete');
  writeProgress({stage, progress: 0});
  if (!existsSync(marker)) {
    mkdirSync(bundleDirectory, {recursive: true, mode: 0o700});
    await bundle({entryPoint: join(webRoot, 'src/remotion/entry.tsx'), rootDir: webRoot,
      outDir: bundleDirectory, onProgress: (value) => writeProgress({stage, progress: value * 0.1})});
    writeFileSync(marker, 'complete', {mode: 0o600});
  }
  stage = 'browser';
  writeProgress({stage, progress: 10});
  await ensureBrowser();
  stage = 'composition';
  writeProgress({stage, progress: 10});
  const composition = await selectComposition({serveUrl: bundleDirectory, id: 'Lesson', inputProps});
  if (composition.width !== 1280 || composition.height !== 720) throw new Error('Lesson must be 1280 × 720');
  stage = 'rendering';
  const output = join(directory, 'lesson.mp4');
  await renderMedia({composition, serveUrl: bundleDirectory, inputProps, outputLocation: output,
    codec: 'h264', pixelFormat: 'yuv420p', crf: 20, concurrency: 2, muted: true,
    onProgress: ({progress, stitchStage}) => {
      stage = stitchStage === 'muxing' ? 'encoding' : 'rendering';
      writeProgress({stage, progress: 10 + progress * 89});
    }});
  chmodSync(output, 0o600);
  writeProgress({stage: 'ready', progress: 100, durationSeconds: composition.durationInFrames / composition.fps,
    frameCount: composition.durationInFrames, fps: composition.fps, width: composition.width, height: composition.height});
} catch (error) {
  // Diagnostic stays private. The renderer never received the server's AI/DB credentials.
  writeFileSync(join(directory, 'renderer-error.json'), JSON.stringify({stage,
    name: error instanceof Error ? error.name : 'RenderError',
    message: error instanceof Error ? error.message : 'Unknown renderer failure',
    stack: error instanceof Error ? error.stack : null}, null, 2), {mode: 0o600});
  // No raw renderer error, prompt, environment value, or file path is exposed through the API.
  writeProgress({stage, progress: 0, error: 'local-render-failed'});
  process.exitCode = 1;
}
