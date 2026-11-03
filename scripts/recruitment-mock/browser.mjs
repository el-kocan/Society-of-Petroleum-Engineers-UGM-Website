import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { access, mkdtemp, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export async function checkBrowser({ origin, artifacts, env }) {
  const chrome = process.platform === "win32"
    ? "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe"
    : "/usr/bin/chromium";
  await access(chrome); // No install or browser download fallback.
  const profile = await mkdtemp(path.join(artifacts, "isolated-chrome-profile-"));
  const browser = spawn(chrome, [
    "--headless=new", "--no-first-run", "--no-default-browser-check",
    "--disable-background-networking", "--disable-component-update",
    "--disable-sync", "--disable-extensions", "--disable-default-apps",
    "--disable-domain-reliability", "--disable-breakpad",
    "--force-webrtc-ip-handling-policy=disable_non_proxied_udp",
    "--proxy-server=http://127.0.0.1:9",
    "--proxy-bypass-list=127.0.0.1;localhost;[::1]",
    "--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1, EXCLUDE localhost",
    "--remote-debugging-address=127.0.0.1", "--remote-debugging-port=0",
    `--user-data-dir=${profile}`, "about:blank",
  ], { env, windowsHide: true, stdio: "ignore" });
  let socket;
  try {
    let debugPort;
    for (let attempt = 0; attempt < 60; attempt++) {
      try {
        debugPort = (await readFile(path.join(profile, "DevToolsActivePort"), "utf8")).split("\n")[0].trim();
        break;
      } catch { await pause(250); }
    }
    assert(debugPort, "Chrome unavailable; browser checks stopped");
    // DevToolsActivePort can appear before its HTTP endpoint accepts requests.
    let target;
    for (let attempt = 0; attempt < 60; attempt++) {
      try {
        const targets = await (await fetch(`http://127.0.0.1:${debugPort}/json/list`, { signal: AbortSignal.timeout(1000) })).json();
        target = targets.find((entry) => entry.type === "page");
        if (target) break;
      } catch { /* Retry local Chrome readiness only; no external fallback. */ }
      await pause(250);
    }
    assert(target, 'Chrome debugging endpoint unavailable');
    socket = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => {
      socket.addEventListener("open", resolve, { once: true });
      socket.addEventListener("error", reject, { once: true });
    });
    let id = 0;
    const pending = new Map();
    const external = [];
    const requests = [];
    const exceptions = [];
    let liveMode = false;
    let livePosts = 0;
    const livePeriod = { id:"synthetic-period", label:"Synthetic staging test", contentState:"approved", notice:"Synthetic browser fixture", batches:["2026"], divisions:[{id:"example-a",label:"Synthetic main",subDivisions:[{id:"a-none",label:"Synthetic first",assignment:{status:"none",message:"No assignment"}},{id:"a-optional",label:"Synthetic second",assignment:{status:"optional",instructions:"Optional",upload:{formats:["pdf"],maxBytes:3145728,filename:"assignment.pdf"}}}]}] };
    function send(method, params = {}) {
      return new Promise((resolve, reject) => {
        const requestId = ++id;
        const timeout = setTimeout(() => { pending.delete(requestId); reject(new Error(`CDP timeout: ${method}`)); }, 15000);
        pending.set(requestId, { resolve, reject, timeout });
        socket.send(JSON.stringify({ id: requestId, method, params }));
      });
    }
    socket.addEventListener("message", ({ data }) => {
      const message = JSON.parse(data);
      if (message.id) {
        const action = pending.get(message.id);
        if (!action) return;
        pending.delete(message.id);
        clearTimeout(action.timeout);
        if (message.error) action.reject(new Error(message.error.message));
        else action.resolve(message.result);
      } else if (message.method === "Fetch.requestPaused") {
        const { requestId, request } = message.params;
        const url = new URL(request.url);
        if (url.origin !== origin) {
          external.push({ protocol: url.protocol, blocked: true });
          void send("Fetch.failRequest", { requestId, errorReason: "BlockedByClient" }).catch(() => {});
        } else {
          requests.push({ path: url.pathname, method: request.method });
          if (liveMode && url.pathname === "/api/recruitment") {
            let responseCode=200, payload;
            if (request.method === "GET") payload={period:livePeriod,token:"synthetic-browser-session"};
            else { livePosts++; responseCode=livePosts===1?503:200; payload=livePosts===1?{error:"Synthetic temporary failure. Retry unchanged."}:{applicationId:"synthetic-receipt-001"}; }
            void send("Fetch.fulfillRequest", {requestId,responseCode,responseHeaders:[{name:"Content-Type",value:"application/json"}],body:Buffer.from(JSON.stringify(payload)).toString("base64")}).catch(() => {});
          } else void send("Fetch.continueRequest", { requestId }).catch(() => {});
        }
      } else if (message.method === "Runtime.exceptionThrown") exceptions.push(message.params.exceptionDetails.text);
    });
    async function evaluate(expression) {
      const result = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
      if (result.exceptionDetails) throw new Error(`Browser script failed: ${result.exceptionDetails.text}`);
      return result.result.value;
    }
    async function waitFor(expression, message) {
      for (let attempt = 0; attempt < 80; attempt++) {
        if (await evaluate(expression)) return;
        await pause(100);
      }
      throw new Error(message);
    }
    async function navigate(route) {
      await send("Page.navigate", { url: origin + route });
      await waitFor(`location.pathname === ${JSON.stringify(route)} && document.readyState === 'complete'`, `Navigation failed: ${route}`);
      await pause(300);
    }
    async function click(label) {
      const clicked = await evaluate(`(() => {const button = [...document.querySelectorAll('button')].find(el => el.textContent.trim().startsWith(${JSON.stringify(label)}) || el.getAttribute('aria-label') === ${JSON.stringify(label)}); if(!button) return false; button.click(); return true;})()`);
      assert(clicked, `Button missing: ${label}`);
      await pause(100);
    }
    async function fill(key, value) {
      await evaluate(`(() => {
        const el = document.getElementById(${JSON.stringify(`recruit-${key}`)});
        const proto = el.tagName === 'SELECT' ? HTMLSelectElement.prototype : el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
        Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, ${JSON.stringify(value)});
        el.dispatchEvent(new Event(el.tagName === 'SELECT' ? 'change' : 'input', {bubbles:true}));
      })()`);
      await pause(30);
    }
    async function upload(key, filename) {
      const { root } = await send("DOM.getDocument");
      const { nodeId } = await send("DOM.querySelector", { nodeId: root.nodeId, selector: `#recruit-${key}` });
      await send("DOM.setFileInputFiles", { nodeId, files: [path.join(artifacts, filename)] });
      await pause(100);
    }
    async function screenshot(name, selector) {
      await evaluate(selector
        ? `window.scrollTo(0, document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect().top + scrollY - 130)`
        : "window.scrollTo(0, 0)");
      // Let the existing public header entrance finish before visual capture.
      await pause(1100);
      const result = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
      await writeFile(path.join(artifacts, name), Buffer.from(result.data, "base64"));
    }
    await send("Page.enable");
    await send("Runtime.enable");
    await send("Network.enable");
    await send("Network.setBypassServiceWorker", { bypass: true });
    await send("Fetch.enable", { patterns: [{ urlPattern: "*", requestStage: "Request" }] });
    await send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
    await navigate("/join");
    // Prove browser HTTP and HTTPS are intercepted before testing personal fields.
    const browserProof = await evaluate(`Promise.all(['http://example.invalid/browser-probe', 'https://example.invalid/browser-probe'].map(url => fetch(url).then(() => false, () => true)))`);
    assert.deepEqual(browserProof, [true, true]);
    assert(external.some((request) => request.protocol === "http:") && external.some((request) => request.protocol === "https:"));
    external.length = 0;
    requests.length = 0;
    console.log("PASS: Chrome external HTTP/HTTPS blocked before form testing; dead proxy and DNS deny rules active");
    await waitFor("document.fonts.status === 'loaded'", "Offline fonts not loaded");
    await screenshot("join-desktop.png");
    assert(await evaluate("document.body.textContent.includes('Staff Application Period')"));
    assert(await evaluate("[...document.querySelectorAll('a')].filter(a=>a.textContent.includes('Join SPE')).every(a=>a.getAttribute('href')==='/join')"));
    await writeFile(path.join(artifacts, "sample.pdf"), "%PDF-1.4\n% Synthetic QA fixture\n%%EOF");
    await writeFile(path.join(artifacts, "preference-1.pdf"), "%PDF-1.4\n% Synthetic first preference\n%%EOF");
    await writeFile(path.join(artifacts, "preference-2.pdf"), "%PDF-1.4\n% Synthetic second preference\n%%EOF");
    await writeFile(path.join(artifacts, "sample.png"), Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=", "base64"));
    await writeFile(path.join(artifacts, "wrong.txt"), "Synthetic invalid file");
    await writeFile(path.join(artifacts, "oversize.pdf"), Buffer.alloc(3 * 1024 * 1024 + 1));
    await writeFile(path.join(artifacts, "empty.pdf"), "");
    const viewportResults = [];
    const summarySelector = (rank) => `button[aria-label="Edit ${rank === 1 ? "First" : "Second"} preference"]`;
    async function summary(rank) {
      return evaluate(`document.querySelector(${JSON.stringify(summarySelector(rank))}).closest('section').textContent`);
    }
    async function submitDisabled() {
      return evaluate("[...document.querySelectorAll('button')].find(el=>el.textContent.startsWith('Complete preview')).disabled");
    }
    async function noOverflow() {
      assert(await evaluate("document.documentElement.scrollWidth <= innerWidth"), "Horizontal overflow");
    }
    async function finishReview(rank) {
      for (let step = rank; step < 3; step++) await click("Next");
      await click("Review application");
      await waitFor("document.getElementById('wizard-title').textContent.includes('Review')", "Review missing");
      await noOverflow();
    }
    for (const viewport of [
      { name: "desktop", width: 1440, height: 1000, mobile: false },
      { name: "mobile", width: 390, height: 844, mobile: true },
    ]) {
      await send("Emulation.setDeviceMetricsOverride", { width: viewport.width, height: viewport.height, deviceScaleFactor: 1, mobile: viewport.mobile });
      await navigate("/join/apply");
      assert.equal(await evaluate("document.getElementById('recruit-catalog').value"), "draft");
      await fill("catalog", "demo");
      await click("Next");
      assert(await evaluate("document.querySelector('[role=alert]') !== null && document.activeElement.id === 'recruit-fullName'"));
      for (const [key, value] of Object.entries({ fullName: "Synthetic Applicant", nim: "SYNTHETIC-001", birthPlace: "Kota Contoh", birthDate: "2099-01-01", ugmEmail: "not-an-email", phoneNumber: "abc", major: "Program Studi Contoh", batch: "2026" })) await fill(key, value);
      await click("Next");
      assert.equal(await evaluate("document.querySelectorAll('[aria-invalid=true]').length"), 3);
      await fill("birthDate", "2007-01-02");
      await fill("ugmEmail", "synthetic@example.invalid");
      await fill("phoneNumber", "+620000000001");
      await evaluate("document.getElementById('recruit-fullName').focus()");
      await send("Input.dispatchKeyEvent", { type: "keyDown", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 });
      await send("Input.dispatchKeyEvent", { type: "keyUp", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 });
      await waitFor("!!document.getElementById('recruit-division1')", "Keyboard Next failed");

      // Rank 1: First preference with required assignment
      assert(await evaluate("document.getElementById('recruit-subDivision1').disabled"));
      await fill("division1", "example-a");
      assert(await evaluate("!document.getElementById('recruit-subDivision1').disabled && [...document.getElementById('recruit-subDivision1').options].slice(1).every(option=>option.value.startsWith('a-'))"));
      await fill("subDivision1", "a-required");
      await fill("motivation1", "Alasan sintetis untuk pilihan 1.");
      assert.equal(await evaluate("document.getElementById('recruit-assignment1').getAttribute('aria-required')"), "true");
      await click("Next");
      assert(await evaluate("document.getElementById('recruit-assignment1-error') !== null"));
      for (const [filename, message] of [["wrong.txt", "PDF"], ["oversize.pdf", "3 MiB"], ["empty.pdf", "empty"]]) {
        await upload("assignment1", filename);
        assert((await evaluate("document.getElementById('recruit-assignment1-error').textContent")).includes(message));
      }
      await upload("assignment1", "preference-1.pdf");
      await click("Back");
      assert.equal(await evaluate("document.getElementById('recruit-fullName').value"), "Synthetic Applicant");
      await click("Next");
      assert(await evaluate("document.getElementById('recruit-subDivision1').value === 'a-required' && document.body.textContent.includes('preference-1.pdf')"));
      await click("Next");

      // Rank 2: Second preference has NO assignment upload
      assert(await evaluate("document.getElementById('recruit-subDivision2').disabled"));
      await fill("division2", "example-b");
      assert(await evaluate("!document.getElementById('recruit-subDivision2').disabled && [...document.getElementById('recruit-subDivision2').options].slice(1).every(option=>option.value.startsWith('b-'))"));
      await fill("subDivision2", "b-required");
      await fill("motivation2", "Alasan sintetis untuk pilihan 2.");
      assert(await evaluate("document.getElementById('recruit-assignment2') === null"));
      assert((await evaluate("document.body.textContent")).includes("Assignments only apply to your first preference choice"));
      await click("Next");

      await click("Review application");
      assert.equal(await evaluate("document.querySelectorAll('[aria-invalid=true]').length"), 5);
      for (const key of ["cv", "idCard", "commitment"]) await upload(key, "sample.pdf");
      for (const key of ["followProof", "storyProof"]) await upload(key, "sample.png");
      await click("Remove Curriculum Vitae");
      await click("Review application");
      assert(await evaluate("document.getElementById('recruit-cv-error') !== null"));
      await upload("cv", "sample.pdf");
      await click("Review application");
      assert.equal(await submitDisabled(), false);
      assert((await summary(1)).includes("Required · preference-1.pdf"));
      assert((await summary(2)).includes("No assignment required"));
      await screenshot(`wizard-required-review-${viewport.name}.png`, summarySelector(1));

      // Same parent is allowed; the exact same sub-division is blocked.
      await click('Edit Second preference');
      await fill('division2', 'example-a');
      await fill('subDivision2', 'a-required');
      await click('Next');
      assert((await evaluate("document.getElementById('recruit-subDivision2-error').textContent")).includes('Choose two different sub-divisions'));
      await fill('subDivision2', 'a-optional');
      assert(await evaluate("document.getElementById('recruit-assignment2') === null"));
      await finishReview(2);
      assert.equal(await submitDisabled(), false);
      await click('Edit Second preference');
      await fill('division2', 'example-b');
      await fill('subDivision2', 'b-required');
      await finishReview(2);

      // Drive every conditional state on First preference at both viewport sizes.
      const editLabel = "Edit First preference";
      await click(editLabel);
      await fill("subDivision1", "a-optional");
      assert.equal(await evaluate("document.getElementById('recruit-assignment1').getAttribute('aria-required')"), "false");
      assert(!(await evaluate("document.body.textContent")).includes("preference-1.pdf"), "Sub-division retained an irrelevant assignment");
      await upload("assignment1", "wrong.txt");
      await click("Next");
      assert(await evaluate("document.getElementById('recruit-assignment1-error') !== null"), "Optional invalid file accepted");
      await click("Remove First preference assignment");
      await finishReview(1);
      assert((await summary(1)).includes("Not attached (optional)"));
      assert.equal(await submitDisabled(), false);
      await click(editLabel);
      await upload("assignment1", "preference-1.pdf");
      await finishReview(1);
      assert((await summary(1)).includes("Optional · preference-1.pdf"));

      await click(editLabel);
      await fill("subDivision1", "a-none");
      assert(await evaluate("document.getElementById('recruit-assignment1') === null"));
      assert(!(await evaluate("document.body.textContent")).includes("preference-1.pdf"));
      assert((await evaluate("document.body.textContent")).includes("No assignment is needed"));
      await noOverflow();
      await screenshot(`wizard-none-1-${viewport.name}.png`, "#recruit-division1");
      await finishReview(1);
      assert((await summary(1)).includes("No assignment required"));
      assert.equal(await submitDisabled(), false);

      await click(editLabel);
      await fill("subDivision1", "a-unconfirmed");
      assert(await evaluate("document.getElementById('recruit-assignment1') === null"));
      await finishReview(1);
      assert((await summary(1)).includes("Unconfirmed — submission blocked"));
      assert.equal(await submitDisabled(), true);
      assert(await evaluate("document.getElementById('submission-blockers') !== null"));
      await click("Complete preview");
      assert(!(await evaluate("document.body.textContent")).includes("Preview completed."));
      await screenshot(`wizard-unconfirmed-1-${viewport.name}.png`, "#submission-blockers");

      await click(editLabel);
      await fill("subDivision1", "a-required");
      await upload("assignment1", "preference-1.pdf");
      await fill("division1", "example-b");
      assert.equal(await evaluate("document.getElementById('recruit-subDivision1').value"), "");
      assert(await evaluate("document.getElementById('recruit-assignment1') === null"));
      assert(!(await evaluate("document.body.textContent")).includes("preference-1.pdf"));
      await fill("subDivision1", "b-required");
      await click("Next");
      assert(await evaluate("document.getElementById('recruit-assignment1-error') !== null"), "Main-division change retained assignment state");
      await fill("division1", "example-a");
      await fill("subDivision1", "a-required");
      await upload("assignment1", "preference-1.pdf");
      await finishReview(1);
      assert((await summary(1)).includes("Required · preference-1.pdf"));
      assert((await summary(2)).includes("No assignment required"));

      // Verify rank 2 never requires an assignment across any sub-division state
      await click("Edit Second preference");
      await fill("subDivision2", "b-optional");
      assert(await evaluate("document.getElementById('recruit-assignment2') === null"));
      await finishReview(2);
      assert((await summary(2)).includes("No assignment required"));
      assert.equal(await submitDisabled(), false);

      await click("Edit Second preference");
      await fill("subDivision2", "b-none");
      assert(await evaluate("document.getElementById('recruit-assignment2') === null"));
      await finishReview(2);
      assert((await summary(2)).includes("No assignment required"));
      assert.equal(await submitDisabled(), false);

      // Draft data switching: switching catalogue clears assignments
      await fill("catalog", "draft");
      assert.equal(await evaluate("document.getElementById('recruit-fullName').value"), "Synthetic Applicant");
      await click("Next");
      await fill("division1", "external-affairs");
      await fill("subDivision1", "relations-partnership");
      assert(await evaluate("document.getElementById('recruit-assignment1') === null"));
      await fill("motivation1", "Synthetic motivation");
      await click("Next");
      await fill("division2", "finance");
      await fill("subDivision2", "sponsorship");
      await fill("motivation2", "Synthetic motivation");
      await finishReview(2);
      assert((await summary(1)).includes("Relations & Partnership") && (await summary(2)).includes("Sponsorship"));
      assert((await summary(1)).includes("No assignment required") && (await summary(2)).includes("No assignment required"));
      assert.equal(await submitDisabled(), false);
      await screenshot(`wizard-draft-review-${viewport.name}.png`, summarySelector(1));

      // Test draft rank 1 requiring an assignment
      await click("Edit First preference");
      await fill("division1", "internal-affairs");
      await fill("subDivision1", "human-capital");
      assert(await evaluate("document.getElementById('recruit-assignment1') !== null"));
      await click("Next");
      assert(await evaluate("document.getElementById('recruit-assignment1-error') !== null"));
      await upload("assignment1", "preference-1.pdf");
      await finishReview(1);
      assert((await summary(1)).includes("Required · preference-1.pdf"));
      assert((await summary(2)).includes("No assignment required"));
      assert.equal(await submitDisabled(), false);

      await fill("catalog", "demo");
      await click("Next");
      await fill("division1", "example-a");
      await fill("subDivision1", "a-none");
      await click("Next");
      await fill("division2", "example-b");
      await fill("subDivision2", "b-optional");
      await finishReview(2);
      assert((await summary(1)).includes("No assignment required"));
      assert((await summary(2)).includes("No assignment required"));
      assert.equal(await submitDisabled(), false);
      await screenshot(`wizard-review-${viewport.name}.png`, summarySelector(1));
      await click("Complete preview");
      await waitFor("document.body.textContent.includes('Preview completed.')", "Simulation success missing");
      assert(await evaluate("document.body.textContent.includes('No real application was submitted.')"));
      assert(await evaluate("localStorage.length === 0 && sessionStorage.length === 0 && document.cookie === ''"), "Unexpected browser persistence");
      const { cookies } = await send("Network.getCookies", { urls: [origin] });
      assert.equal(cookies.length, 0, "Unexpected cookies, including HttpOnly");
      await screenshot(`wizard-success-${viewport.name}.png`);
      await click("Restart preview");
      assert.equal(await evaluate("document.getElementById('recruit-fullName').value"), "");
      await fill("fullName", "Synthetic reload check");
      await send("Page.reload", { ignoreCache: true });
      await waitFor("document.readyState === 'complete' && !!document.getElementById('recruit-fullName') && document.getElementById('recruit-fullName').value === ''", "Reload retained data");
      await noOverflow();
      viewportResults.push({ viewport: `${viewport.width}x${viewport.height}`, preferences: [1, 2], assignmentStates: ["required", "optional", "none", "unconfirmed"], passed: true });
      console.log(`PASS: ${viewport.name} — both preferences, four assignment states, file resets, review, blocked draft and mock success`);
    }
    await navigate("/join");
    assert(await evaluate("document.documentElement.scrollWidth <= innerWidth"), "Mobile landing horizontal overflow");
    await screenshot("join-mobile.png");
    await evaluate("document.querySelector('button[aria-controls=\"mobile-nav\"]').click()");
    assert(await evaluate("document.querySelector('#mobile-nav a[href=\"/join\"]') !== null"));

    assert.equal(external.length, 0, "Recruitment attempted external communication");
    assert(requests.every((request) => request.method === "GET" && !request.path.startsWith("/api/")), "Unexpected submission/API request");
    assert.equal(exceptions.length, 0, "Browser runtime exception");
    liveMode = true;
    await navigate("/backend-wizard-test");
    await waitFor("!!document.getElementById('recruit-fullName')", "Live configuration did not load");
    assert(await evaluate("document.getElementById('recruit-catalog') === null"), "Live mode exposed draft selector");
    for (const [key,value] of Object.entries({fullName:"Synthetic Applicant",nim:"SYNTHETIC-001",birthPlace:"Synthetic",birthDate:"2005-02-01",ugmEmail:"synthetic@example.invalid",phoneNumber:"+620000000001",major:"Synthetic",batch:"2026"})) await fill(key,value);
    await click("Next");
    await fill("division1","example-a"); await fill("subDivision1","a-none"); await fill("motivation1","Synthetic first preference");
    await click("Next");
    await fill("division2","example-a"); await fill("subDivision2","a-optional"); await fill("motivation2","Synthetic second preference");
    await click("Next");
    for (const slot of ["cv","idCard","commitment"]) await upload(slot,"sample.pdf");
    for (const slot of ["followProof","storyProof"]) await upload(slot,"sample.png");
    await click("Review application"); await click("Submit application");
    await waitFor("document.body.textContent.includes('Synthetic temporary failure')", "Live failure not shown");
    assert((await evaluate("document.body.textContent")).includes("Synthetic Applicant"), "Failure cleared retry payload");
    await click("Submit application");
    await waitFor("document.body.textContent.includes('synthetic-receipt-001')", "Live receipt missing");
    assert.equal(livePosts,2);
    assert.equal(external.length,0);
    assert.equal(exceptions.length,0,"Backend-mode browser runtime exception");
    await screenshot("wizard-backend-mocked-success.png");
    console.log("PASS: backend-mode wizard loads approved config, allows same-parent preferences, retains failed payload and confirms retried submission (mock HTTP only)");
    await writeFile(path.join(artifacts, "browser-results.json"), JSON.stringify({
      passed: true, viewports: viewportResults, backendMock: { passed:true, submissions:livePosts, cloudRequests:0 },
      checks: ["external HTTP/HTTPS blocked", "required fields and focus", "invalid email/date/phone", "keyboard navigation", "file type/size/empty validation", "previous preserves values/files", "required and optional assignments", "no-assignment explanation", "unconfirmed blocks final submission", "division and sub-division clear obsolete files", "preferences remain independent", "review status and names", "draft/demo catalogue switching", "five supporting documents", "memory-only success", "reset and reload", "no cookies/localStorage/sessionStorage", "public navigation", "no horizontal overflow"],
      externalRequestsDuringFlow: external.length,
      submissionOrApiRequests: requests.filter((request) => request.method !== "GET" || request.path.startsWith("/api/")).length,
      runtimeExceptions: exceptions.length,
    }, null, 2));
    console.log("PASS: desktop/mobile mock and backend-mode mocked HTTP wizard; zero external backend requests");
    console.log("Screenshots and browser results:", artifacts);
  } finally {
    if (socket?.readyState === WebSocket.OPEN) socket.close();
    browser.kill();
  }
}
