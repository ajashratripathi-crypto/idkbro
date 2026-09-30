const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const execFileAsync = promisify(execFile);

async function main() {
  if (process.platform !== 'win32') throw new Error('The packaged Windows runtime must be fetched from Windows (use the included GitHub Actions workflow, or run this script on Windows).');
  const vendor = path.resolve(__dirname, '..', 'vendor', 'llama');
  try { await fs.access(path.join(vendor, 'llama-server.exe')); console.log('llama-server.exe already exists; keeping the bundled runtime.'); return; } catch {}

  const api = await fetch('https://api.github.com/repos/ggml-org/llama.cpp/releases/latest', { headers: { 'User-Agent': 'NexusEcoDesktop-build', 'Accept': 'application/vnd.github+json' } });
  if (!api.ok) throw new Error(`Could not read the llama.cpp release list (HTTP ${api.status}).`);
  const release = await api.json();
  const expected = `llama-${release.tag_name}-bin-win-cpu-x64.zip`;
  const asset = release.assets.find(item => item.name === expected);
  if (!asset) throw new Error(`Could not find the official Windows CPU x64 runtime asset ${expected}.`);
  const download = await fetch(asset.browser_download_url, { headers: { 'User-Agent': 'NexusEcoDesktop-build' } });
  if (!download.ok || !download.body) throw new Error(`llama.cpp download failed (HTTP ${download.status}).`);

  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'nexuseco-llama-'));
  const archive = path.join(temp, 'llama.zip');
  await fs.writeFile(archive, Buffer.from(await download.arrayBuffer()));
  const extracted = path.join(temp, 'runtime');
  await fs.mkdir(extracted, { recursive: true });
  await execFileAsync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', 'Expand-Archive -LiteralPath $args[0] -DestinationPath $args[1] -Force', archive, extracted], { windowsHide: true });
  async function locate(folder) {
    for (const item of await fs.readdir(folder, { withFileTypes: true })) {
      const full = path.join(folder, item.name);
      if (item.isFile() && item.name.toLowerCase() === 'llama-server.exe') return full;
      if (item.isDirectory()) { const found = await locate(full); if (found) return found; }
    }
    return null;
  }
  const executable = await locate(extracted);
  if (!executable) throw new Error('The release ZIP did not contain llama-server.exe.');
  await fs.mkdir(vendor, { recursive: true });
  await fs.cp(path.dirname(executable), vendor, { recursive: true, force: false });
  console.log(`Bundled llama.cpp ${release.tag_name} CPU x64 runtime in vendor/llama.`);
  await fs.rm(temp, { recursive: true, force: true });
}

main().catch(error => { console.error(error.message); process.exitCode = 1; });
