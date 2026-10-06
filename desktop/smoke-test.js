/**
 * Headless smoke test for the app:// protocol and window load.
 * Run: ./node_modules/.bin/electron desktop/smoke-test.js --no-sandbox
 */
const { app, BrowserWindow, protocol } = require("electron");
const fs = require("fs");
const path = require("path");
const { BUILD_ROOT, serveAppRequest } = require("./serve");

protocol.registerSchemesAsPrivileged([
  {
    scheme: "app",
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true,
    },
  },
]);

let exitCode = 1;
let finished = false;

function fail(message) {
  if (finished) {
    return;
  }
  finished = true;
  console.error(message);
  exitCode = 1;
  app.quit();
}

function pass(message) {
  if (finished) {
    return;
  }
  finished = true;
  console.log(message);
  exitCode = 0;
  app.quit();
}

function findFirstPng() {
  const iconsDir = path.join(BUILD_ROOT, "images/icons");
  if (!fs.existsSync(iconsDir)) {
    return null;
  }
  const entries = fs.readdirSync(iconsDir);
  const png = entries.find((name) => name.endsWith(".png"));
  return png ? `/images/icons/${png}` : null;
}

app.whenReady().then(async () => {
  const appJsResponse = serveAppRequest({ url: "app://local/app.js" });
  if (appJsResponse.headers.get("Content-Type") !== "text/javascript") {
    fail("FAIL: app.js Content-Type");
    return;
  }

  const missingJs = serveAppRequest({ url: "app://local/does-not-exist.js" });
  if (missingJs.status !== 404) {
    fail("FAIL: missing .js should return 404");
    return;
  }

  const pngPath = findFirstPng();
  if (!pngPath) {
    fail("FAIL: no PNG in build/images/icons to test");
    return;
  }
  const pngResponse = serveAppRequest({ url: `app://local${pngPath}` });
  if (pngResponse.headers.get("Content-Type") !== "image/png") {
    fail("FAIL: PNG Content-Type");
    return;
  }

  const fallback = serveAppRequest({ url: "app://local/transactions" });
  if (fallback.headers.get("Content-Type") !== "text/html") {
    fail("FAIL: SPA fallback Content-Type");
    return;
  }

  protocol.handle("app", (request) => serveAppRequest(request));

  const win = new BrowserWindow({
    show: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
    },
  });

  const win2 = new BrowserWindow({
    show: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
    },
  });

  let step = 0;

  win.webContents.on("did-finish-load", async () => {
    try {
      if (step !== 0) {
        return;
      }
      const hasApp = await win.webContents.executeJavaScript(
        "Boolean(document.getElementById('app'))",
      );
      if (!hasApp) {
        fail("FAIL: #app root missing on home");
        return;
      }
      step = 1;
      await win.loadURL("app://local/transactions");
    } catch (err) {
      fail(`FAIL: ${err.message}`);
    }
  });

  win.webContents.on("did-finish-load", async () => {
    try {
      if (step !== 1) {
        return;
      }
      const hasApp = await win.webContents.executeJavaScript(
        "Boolean(document.getElementById('app'))",
      );
      if (!hasApp) {
        fail("FAIL: deep route did not load app shell");
        return;
      }
      await win.webContents.executeJavaScript(`
        new Promise((resolve, reject) => {
          const req = indexedDB.open("seven23-desktop-smoke", 1);
          req.onupgradeneeded = () => req.result.createObjectStore("t");
          req.onsuccess = () => {
            const tx = req.result.transaction("t", "readwrite");
            tx.objectStore("t").put("persisted", "amount");
            tx.oncomplete = () => resolve(true);
            tx.onerror = () => reject(tx.error);
          };
          req.onerror = () => reject(req.error);
        });
      `);
      step = 2;
      void win2.loadURL("app://local/");
    } catch (err) {
      fail(`FAIL: ${err.message}`);
    }
  });

  win2.webContents.on("did-finish-load", async () => {
    try {
      if (step !== 2) {
        return;
      }
      const value = await win2.webContents.executeJavaScript(`
        new Promise((resolve, reject) => {
          const req = indexedDB.open("seven23-desktop-smoke", 1);
          req.onsuccess = () => {
            const tx = req.result.transaction("t", "readonly");
            const get = tx.objectStore("t").get("amount");
            get.onsuccess = () => resolve(get.result);
            get.onerror = () => reject(get.error);
          };
          req.onerror = () => reject(req.error);
        });
      `);
      if (value !== "persisted") {
        fail("FAIL: IndexedDB did not persist across windows");
        return;
      }
      win.close();
      win2.close();
      pass(
        "PASS: protocol types, 404 for missing assets, shell load, /transactions fallback, IndexedDB persistence",
      );
    } catch (err) {
      fail(`FAIL: ${err.message}`);
    }
  });

  await win.loadURL("app://local/");
});

app.on("window-all-closed", () => {
  process.exit(exitCode);
});
