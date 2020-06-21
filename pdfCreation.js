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

    var ctx;
    for (let i = 0; i < urls.length; i++) {
        var url = urls[i];
        if (!url) continue;
        var img = await urlToImage(url);
        if (i == 0) {
            downscaleCanvas.width = img.width / downscaleFactor;
            downscaleCanvas.height = img.height / downscaleFactor;
            ctx = downscaleCanvas.getContext("2d");
            ctx.imageSmoothingEnabled = true;
            ctx.imageSmoothingQuality = "medium"; //"low" || "medium" || "high"
        }
        ctx.drawImage(img, 0, 0, downscaleCanvas.width, downscaleCanvas.height);
    }

    return downscaleCanvas.toDataURL();
}

async function createRecognitionScheduler() {
    var scheduler = Tesseract.createScheduler();
    var workerCreationJobs = [];
    for (let i = 0; i < 12; i++) {
        workerCreationJobs.push(
            (async () => {
                var recogWorker = Tesseract.createWorker({
                    //  logger: (m) => console.log(m),
                });

                await recogWorker.load();
                await recogWorker.loadLanguage("nld");
                await recogWorker.initialize("nld");
                scheduler.addWorker(recogWorker);
            })()
        );
    }
    await Promise.all(workerCreationJobs);
    return scheduler;
}

var globalProgressInfo = {
    progress: 0.0,
    status: "",
    pagesDone: 0,
    busy: false
};

var jobs = [];
var recogScheduler;
async function createPDFWithTextRecognition(startPage, endPage, includeHidden = true) {
    console.log("Creating Tesseract workers/scheduler...");
    globalProgressInfo = {
        progress: 0.0,
        status: "Enabling Tesseract...",
        pagesDone: 0,
        busy: true
    };

    if (!recogScheduler) recogScheduler = await createRecognitionScheduler();

    console.log("Starting recognition...");
    globalProgressInfo.status = "Recognizing..."

    for (let p = startPage; p <= endPage; p += 2) {
        selectPage(p);
        await new Promise((resolve) => setTimeout(resolve, 500));

        const leftBase64 = await urlsToBase64Downscale(getLeftPageUrls(includeHidden));
        const rightBase64 = await urlsToBase64Downscale(getRightPageUrls(includeHidden));

        if (leftBase64) {
            jobs.push(
                recogScheduler
                    .addJob("recognize", leftBase64)
                    .then((recog) => {
                        globalProgressInfo.progress = ++globalProgressInfo.pagesDone / (endPage - startPage);
                        //console.log("Did left page", p, globalProgressInfo.pagesDone, "done", globalProgressInfo.progress);
                        return { base64: leftBase64, recog };
                    })
                    .catch((err) => {
                        console.warn("Could not recognize left image, skipped:", err);
                    })
            );
        }

        if (rightBase64) {
            jobs.push(
                recogScheduler
                    .addJob("recognize", rightBase64)
                    .then((recog) => {
                        globalProgressInfo.progress = ++globalProgressInfo.pagesDone / (endPage - startPage);
                        //console.log("Did right page", p, globalProgressInfo.pagesDone, "done", globalProgressInfo.progress);
                        return { base64: rightBase64, recog };
                    })
                    .catch((err) => {
                        console.warn("Could not recognize right image, skipped:", err);
                    })
            );
        }
    }

    const results = await Promise.all(jobs);

    const doc = await createPDFFromRecognitionJob(results);
    await savePdf(doc);

    globalProgressInfo = {
        busy: false,
        progress: 1,
        status: "Ready",
        pagesDone: 0
    }
}

async function savePdf(doc) {
    console.log("Saving...");
    globalProgressInfo.status = "Saving...";

    await addPDFWaterMark(doc);
    doc.save(document.title + ".pdf");
}

var doc;
async function createPDFFromRecognitionJob(results) {
    console.log("Creating pdf...");
    globalProgressInfo = {
        pagesDone: 0,
        status: "Generating PDF...",
        progress: 0.0,
        busy: true
    }

    doc = new jsPDF("p", "pt", "a4", true);
    doc.setTextColor("#000000");
    doc.setFont("courier");
    var pw = doc.internal.pageSize.getWidth(),
        ph = doc.internal.pageSize.getHeight();

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
        globalProgressInfo.pagesDone++;
        globalProgressInfo.progress = (j + 1) / results.length;
    }

    return doc;
}

async function addPDFWaterMark(doc) {
    doc.setTextColor("#888888");
    doc.setFont("courier");
    var base64 = await urlToBase64(chrome.extension.getURL("images/icon256.png"));
    doc.addImage(base64, "PNG", 50, 50, 80, 80, undefined, "FAST");
    doc.text(150, 50, "Created with SCOPlayer To PDF chrome extension.\nBy Stijn Rogiest");
}

async function createNormalPDF(startPage, endPage, includeHidden = true) {
    console.log("Creating pdf...");
    globalProgressInfo = {
        pagesDone: 0,
        status: "Generating PDF...",
        progress: 0.0,
        busy: true
    }

    doc = new jsPDF("p", "pt", "a4", true);
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

        globalProgressInfo.pagesDone += 2;
        globalProgressInfo.progress = (p - startPage + 1) / (endPage - startPage);
    }

    await savePdf(doc);

    globalProgressInfo = {
        busy: false,
        progress: 1,
        status: "Ready",
        pagesDone: 0
    }
}

/* These should be altered when a new non-standard PDF viewer is registered */

function getDocument() {
    return document.getElementById("viewFrame")?.contentWindow.document;
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
                    },
                });
            } else {
                sendResponse({
                    scoPlayer: {
                        supported: false,
                    },
                });
            }
            return true;
        case "setHiddenLayer":
            sendResponse({ scoPlayer: setHiddenLayer(message.value) });
            return true;
        case "progress":
            sendResponse({ scoPlayer: globalProgressInfo });
            return true;
        case "createPDF":
            var func = message.recognizeText ? createPDFWithTextRecognition : createNormalPDF;
            func(message.startPage, message.endPage, message.includeHidden);
            sendResponse({ scoPlayer: true });
            return true;
    }

    sendResponse({ scoPlayer: null });
    return true;
});
