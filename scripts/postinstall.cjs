/**
 * Fetches the tools the app bundles but does not build itself.
 *
 * Right now that is Ludusavi, which powers cloud saves. The binary is large and
 * platform specific, so it is downloaded instead of committed (`ludusavi/**` is
 * git-ignored except its config).
 *
 * The download is awaited end to end. The previous version extracted inside a
 * stream `finish` listener, so the process could exit after the bytes landed and
 * leave an unextracted zip behind. On Windows extraction uses the `tar.exe` that
 * ships with the OS (bsdtar reads zip), because `npx extract-zip` would install
 * a package at postinstall time and can prompt.
 */
const { default: axios } = require("axios");
const tar = require("tar");
const fs = require("node:fs");
const path = require("node:path");
const { pipeline } = require("node:stream/promises");
const { execFile } = require("node:child_process");
const util = require("node:util");

const execFileAsync = util.promisify(execFile);

const ludusaviVersion = "0.29.0";

const fileName = {
  win32: `ludusavi-v${ludusaviVersion}-win64.zip`,
  linux: `ludusavi-v${ludusaviVersion}-linux.tar.gz`,
  darwin: `ludusavi-v${ludusaviVersion}-mac.tar.gz`,
};

const ludusaviBinaryName = {
  win32: "ludusavi.exe",
  linux: "ludusavi",
  darwin: "ludusavi",
};

const downloadLudusavi = async () => {
  const platform = process.platform;
  const binaryName = ludusaviBinaryName[platform];
  const archiveName = fileName[platform];

  if (!(binaryName && archiveName)) {
    console.log(`Ludusavi: no download for ${platform}, skipping.`);
    return;
  }

  const targetPath = path.join(process.cwd(), "ludusavi");
  const binaryPath = path.join(targetPath, binaryName);

  if (fs.existsSync(binaryPath)) {
    console.log("Ludusavi already exists, skipping download...");
    return;
  }

  const downloadUrl = `https://github.com/mtkennerly/ludusavi/releases/download/v${ludusaviVersion}/${archiveName}`;

  console.log(`Downloading ${archiveName}...`);

  const response = await axios.get(downloadUrl, {
    responseType: "stream",
    timeout: 10 * 60_000,
  });

  await pipeline(response.data, fs.createWriteStream(archiveName));

  console.log(`Downloaded ${archiveName}, extracting...`);
  fs.mkdirSync(targetPath, { recursive: true });

  if (platform === "win32") {
    await execFileAsync("tar", ["-xf", archiveName, "-C", targetPath]);
  } else {
    await tar.x({ file: archiveName, cwd: targetPath });
    fs.chmodSync(binaryPath, 0o755);
  }

  fs.rmSync(archiveName, { force: true });

  if (!fs.existsSync(binaryPath)) {
    throw new Error(
      `Extracted ${archiveName} but ${binaryName} is missing from ${targetPath}`
    );
  }

  console.log(`Ludusavi ${ludusaviVersion} is ready at ${binaryPath}`);
};

downloadLudusavi().catch((error) => {
  console.error(`Ludusavi download failed: ${error.message}`);
  process.exitCode = 1;
});
