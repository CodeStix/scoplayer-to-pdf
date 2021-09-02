/* Stijn Rogiest 2019-2020 */

// Fast url to base64 method
async function urlToBase64(url) {
    if (!url) return null;
    const res = await fetch(url);

    if (res.status >= 400) return null;

    var blob = await res.blob();

    return new Promise((resolve) => {
        const reader = new FileReader();
        reader.addEventListener("load", () => resolve(reader.result));
        reader.readAsDataURL(blob);
    });
}

function urlToImage(url) {
    return new Promise((resolve, reject) => {
        var img = new Image();
        img.onload = (ev) => resolve(img, ev);
        img.onerror = (ev) => reject(img, ev);
        img.src = url;
    });
}

// Slower url to base64 method, but can layer urls on top of each other and can downscale
var downscaleCanvas;
async function urlsToBase64Downscale(urls, downscaleFactor = 1) {
    if (!urls || urls.length === 0) return null;
    if (urls.length === 1 && downscaleFactor == 1) return await urlToBase64(urls[0]); // Use faster method if only 1 url is specified and if no downscaling is required
    if (!downscaleCanvas) downscaleCanvas = document.createElement("canvas");

    var convertedCount = 0;
    var ctx;
    for (let i = 0; i < urls.length; i++) {
        var url = urls[i];
        if (!url) continue;
        var img;
        try {
            img = await urlToImage(url);
        } catch (ex) {
            console.log("Cannot downscale", url, ex);
            continue;
        }
        if (convertedCount == 0) {
            downscaleCanvas.width = img.width / downscaleFactor;
            downscaleCanvas.height = img.height / downscaleFactor;
            ctx = downscaleCanvas.getContext("2d");
            ctx.imageSmoothingEnabled = true;
            ctx.imageSmoothingQuality = "medium"; //"low" || "medium" || "high"
        }
        ctx.drawImage(img, 0, 0, downscaleCanvas.width, downscaleCanvas.height);
        convertedCount++;
    }

    return convertedCount > 0 ? downscaleCanvas.toDataURL() : null;
}

async function createRecognitionScheduler() {
    var scheduler = Tesseract.createScheduler();
    var workerCreationJobs = [];

    var opt = {
        workerPath: chrome.extension.getURL("tesseract/worker.min.js"),
        // langPath: chrome.extension.getURL("tesseract/lang/"),
        corePath: chrome.extension.getURL("tesseract/tesseract-core.wasm.js"),
        // logger: (m) => console.log(m),
        // cachemethod: "none",
    };

    for (let i = 0; i < 12; i++) {
        workerCreationJobs.push(
            (async () => {
                var recogWorker = Tesseract.createWorker(opt);
                console.log(i, "loading");
                await recogWorker.load();
                console.log(i, "loading lang");
                await recogWorker.loadLanguage("nld");
                console.log(i, "initializing");
                await recogWorker.initialize("nld");
                scheduler.addWorker(recogWorker);
                console.log(i, "done");
            })()
        );
    }
    await Promise.all(workerCreationJobs);
    return scheduler;
}

var globalProgressInfo = {
    busy: false,
};

var jobs = [];
var recogScheduler;
async function createPDFWithTextRecognition(startPage, endPage, includeHidden = true) {
    console.log("Creating Tesseract workers/scheduler...");
    globalProgressInfo = {
        busy: true,
        progress: 0.0,
        status: "Enabling Tesseract...",
    };

    if (!recogScheduler) recogScheduler = await createRecognitionScheduler();

    console.log("Starting recognition...");
    globalProgressInfo.status = "Recognizing...";

    var pagesDone = 0;
    function recognizeBase64(base64) {
        return recogScheduler
            .addJob("recognize", base64)
            .then((recog) => {
                globalProgressInfo.progress = ++pagesDone / (endPage - startPage + 1);
                globalProgressInfo.status = `Recognizing... (${pagesDone}/${endPage - startPage + 1} pages)`;
                //console.log("Did page", p, globalProgressInfo.pagesDone, "done", globalProgressInfo.progress);
                return { base64, recog };
            })
            .catch((err) => {
                console.warn("Could not recognize base64 image, skipped:", err);
            });
    }

    for (let p = startPage; p <= endPage; p += 2) {
        selectPage(p);
        await new Promise((resolve) => setTimeout(resolve, 500));

        const leftBase64 = await urlsToBase64Downscale(getLeftPageUrls(includeHidden));
        const rightBase64 = await urlsToBase64Downscale(getRightPageUrls(includeHidden));

        if (leftBase64) jobs.push(recognizeBase64(leftBase64));
        if (rightBase64) jobs.push(recognizeBase64(rightBase64));
    }

    const results = await Promise.all(jobs);

    const doc = await createPDFFromRecognitionJob(results);
    await savePdf(doc);

    globalProgressInfo = {
        busy: false,
    };
}

async function savePdf(doc) {
    console.log("Saving...");
    globalProgressInfo.status = "Saving...";

    await addPDFWaterMark(doc);
    doc.save(document.title + ".pdf");
}

async function createPDFFromRecognitionJob(results) {
    console.log("Creating pdf...");
    globalProgressInfo = {
        busy: true,
        status: "Generating PDF...",
        progress: 0.0,
    };

    var doc = new jsPDF("p", "pt", "a4", true);
    doc.setTextColor("#000000");
    doc.setFont("courier");
    var pw = doc.internal.pageSize.getWidth(),
        ph = doc.internal.pageSize.getHeight();

    await new Promise((resolve) => {
        for (let j = 0; j < results.length; j++) {
            if (!results[j]) continue;
            const { recog, base64 } = results[j];

            try {
                const imgProps = doc.getImageProperties(base64);
                var lines = recog.data.words;
                for (let i = 0; i < lines.length; i++) {
                    var l = lines[i];
                    var fs = ((l.bbox.y1 - l.bbox.y0) / imgProps.height) * ph;
                    doc.setFontSize(fs);
                    doc.text(l.text, (l.bbox.x0 / imgProps.width) * pw, (l.bbox.y1 / imgProps.height) * ph, {
                        charSpace: Math.max(0, (((l.bbox.x1 - l.bbox.x0) / imgProps.width) * pw) / l.text.length - fs),
                    });
                }
                doc.addImage(base64, "PNG", 0, 0, pw, ph, undefined, "FAST");
            } catch (ex) {
                console.warn("Could not render page", j + 1, ex);
            }

            doc.addPage();

            globalProgressInfo.status = `Generating PDF... (${j + 1}/${results.length} pages)`;
            globalProgressInfo.progress = (j + 1) / results.length;
        }
        resolve();
    });

    return doc;
}

async function addPDFWaterMark(doc) {
    doc.setTextColor("#888888");
    doc.setFont("courier");
    doc.setFontSize(12);
    var base64 = await urlToBase64(chrome.extension.getURL("images/icon256.png"));
    doc.addImage(base64, "PNG", 50, 50, 80, 80, undefined, "FAST");
    doc.text(150, 50, "Created with SCOPlayer To PDF chrome extension.\nBy Stijn Rogiest (github.com/CodeStix)");
}

async function createNormalPDF(startPage, endPage, includeHidden = true) {
    console.log("Creating pdf...");
    globalProgressInfo = {
        status: "Generating PDF...",
        progress: 0.0,
        busy: true,
    };

    var doc = new jsPDF("p", "pt", "a4", true);
    var pw = doc.internal.pageSize.getWidth(),
        ph = doc.internal.pageSize.getHeight();

    for (let p = startPage; p <= endPage; p += 2) {
        selectPage(p);
        await new Promise((resolve) => setTimeout(resolve, 500));

        const leftBase64 = await urlsToBase64Downscale(getLeftPageUrls(includeHidden));
        const rightBase64 = await urlsToBase64Downscale(getRightPageUrls(includeHidden));

        if (leftBase64) {
            try {
                doc.addImage(leftBase64, "PNG", 0, 0, pw, ph, undefined, "FAST");
                doc.addPage();
            } catch (ex) {
                console.warn("Could not render (left) page", p, ex);
            }
        }

        if (rightBase64) {
            try {
                doc.addImage(rightBase64, "PNG", 0, 0, pw, ph, undefined, "FAST");
                doc.addPage();
            } catch (ex) {
                console.warn("Could not render (right) page", p, ex);
            }
        }

        globalProgressInfo.status = `Generating PDF... (${p - startPage + 1}/${endPage - startPage} pages)`;
        globalProgressInfo.progress = (p - startPage + 1) / (endPage - startPage);
    }

    await savePdf(doc);

    globalProgressInfo = {
        busy: false,
    };
}

/* These should be altered when a new non-standard PDF viewer is registered */

function getDocument() {
    return document.getElementById("viewFrame")?.contentWindow.document;
    // document.getElementById("SilverpointPlayer")?.contentWindow.document.getElementById("viewFrame").contentWindow.document
}

function isSupported() {
    return getDocument() != null;
}

function selectPage(n) {
    const pageInput = getDocument().querySelector("#spanHorL > input");
    if (!pageInput) throw new Error("Could not get page input.");

    pageInput.value = n;
    pageInput.dispatchEvent(new Event("change"));
}

function getPageCount() {
    const pageText = getDocument().querySelector("#spanHorL > span");
    if (!pageText) throw new Error("Could not get page count.");
    return parseInt(pageText.innerText.substring(4));
}

function getLeftPageUrls(includeHidden = false) {
    var layers = [getDocument().querySelector("#mainCanvas > div > div > div:nth-child(1) > img")];
    if (includeHidden) layers.push(getDocument().querySelector("#innerClipDiv > div:nth-child(2) > div > div > div:nth-child(1) > img"));
    return layers.filter((e) => e).map((e) => e.src);
}

function getRightPageUrls(includeHidden = false) {
    var layers = [getDocument().querySelector("#mainCanvas > div > div > div:nth-child(2) > img")];
    if (includeHidden) layers.push(getDocument().querySelector("#innerClipDiv > div:nth-child(2) > div > div > div:nth-child(2) > img"));
    return layers.filter((e) => e).map((e) => e.src);
}

function setHiddenLayer(shown) {
    const layer = getDocument().querySelector("#innerClipDiv > div:nth-child(2)");
    if (!layer) return false;

    layer.style.clip = shown ? null : "rect(0,0,0,0)";
    return true;
}

/* Init */

var lastSettings = null;
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (!("scoPlayer" in message)) return;
    message = message.scoPlayer;

    switch (message.type) {
        case "info":
            if (isSupported()) {
                sendResponse({
                    scoPlayer: {
                        supported: true,
                        pageCount: getPageCount(),
                        globalProgressInfo,
                        lastSettings,
                    },
                });
            } else {
                // sendResponse({
                //     scoPlayer: {
                //         supported: false,
                //     },
                // });
            }
            return true;
        case "setHiddenLayer":
            if (!isSupported()) return true;
            sendResponse({ scoPlayer: setHiddenLayer(message.value) });
            return true;
        case "progress":
            if (!isSupported()) return true;
            sendResponse({ scoPlayer: globalProgressInfo });
            return true;
        case "createPDF":
            if (!isSupported()) return true;
            var func = message.recognizeText ? createPDFWithTextRecognition : createNormalPDF;
            func(message.startPage, message.endPage, message.includeHidden);
            lastSettings = {
                recognizeText: message.recognizeText,
                startPage: message.startPage,
                endPage: message.endPage,
                includeHidden: message.includeHidden,
            };
            sendResponse({ scoPlayer: true });
            return true;
    }

    sendResponse({ scoPlayer: null });
    return true;
});
