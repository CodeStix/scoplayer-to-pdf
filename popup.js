window.onload = function () {
    document.querySelector("#hide-hidden-button").addEventListener("click", () => doShowHiddenLayer(false));
    document.querySelector("#show-hidden-button").addEventListener("click", () => doShowHiddenLayer(true));
    document.querySelector("#convert-button").addEventListener("click", doConvertPDF);
    document.querySelector("#advanced-settings-toggle").addEventListener("click", () => {
        var p = document.querySelector("#advanced-settings-collapse");
        if (!p.hasAttribute("collapsed")) p.setAttribute("collapsed", true);
        else p.removeAttribute("collapsed");
    });
    document.querySelector("#github-link").addEventListener("click", () => chrome.tabs.create({ url: "https://github.com/CodeStix/scoplayer-to-pdf" }));

    sendMessage({ type: "info" }).then((res) => {
        const content = document.querySelector("#content");
        if (res.supported) {
            setWarning(null);
            content.style.display = "block";

            var minPage = document.querySelector("#min-page-input");
            minPage.max = res.pageCount;
            minPage.value = 1;
            var maxPage = document.querySelector("#max-page-input");
            maxPage.max = res.pageCount;
            maxPage.value = res.pageCount;

            setProgress(res.globalProgressInfo);
            if (res.lastSettings) setSettings(res.lastSettings);
        } else {
            setWarning("This website is not supported.");
            content.style.display = "none";
        }
    });

    setTimeout(pollProgress, 200);
};

function pollProgress() {
    sendMessage({ type: "progress" }).then((res) => {
        setProgress(res);
        setTimeout(pollProgress, 200);
    });
}

function setWarning(message) {
    var warning = document.querySelector("#warning-unsupported");
    warning.innerText = message;
    warning.style.display = message ? "block" : "none";
}

function sendMessage(message) {
    return new Promise((resolve, reject) => {
        chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
            var tab = tabs[0].id;
            chrome.tabs.sendMessage(tab, { scoPlayer: message }, (res) => {
                if (chrome.runtime.lastError || !res) {
                    // The message was not delivered, inject the scripts that will receive the message
                    chrome.tabs.executeScript(tab, { file: "tesseract.min.js" }, () => {
                        chrome.tabs.executeScript(tab, { file: "jspdf.min.js" }, () => {
                            chrome.tabs.executeScript(tab, { file: "pdfCreation.js" }, () => {
                                chrome.tabs.sendMessage(tab, { scoPlayer: message }, (res) => {
                                    if (chrome.runtime.lastError || !res) {
                                        console.warn("No answer after injecting, this should not happen.");
                                        reject();
                                    } else {
                                        resolve(res.scoPlayer);
                                    }
                                });
                            });
                        });
                    });
                } else {
                    resolve(res.scoPlayer);
                }
            });
        });
    });
}

async function doShowHiddenLayer(show) {
    const res = await sendMessage({ type: "setHiddenLayer", value: show });
    if (!res) {
        setWarning("This page does not have a hidden layer.");
        document.querySelector("#hidden-layer-note").innerText = "";
    } else {
        document.querySelector("#hidden-layer-note").innerText = `The hidden layer is now ${show ? "shown" : "hidden"}.`;
    }
}

function setSettings(settings) {
    const { startPage, endPage, recognizeText, includeHidden } = settings;
    document.querySelector("#min-page-input").value = startPage;
    document.querySelector("#max-page-input").value = endPage;
    document.querySelector("#recognize-text-check").checked = recognizeText;
    document.querySelector("#hidden-layer-check").checked = includeHidden;
}

function setProgress(globalProgressInfo) {
    document.querySelector("#progress-section").style.display = globalProgressInfo.busy ? "block" : "none";
    document.querySelectorAll(".control").forEach((el) => {
        el.disabled = globalProgressInfo.busy;
    });

    if (!globalProgressInfo.busy) return;

    var statusText = document.querySelector("#convert-status");
    statusText.style.display = globalProgressInfo.busy ? "block" : "none";
    statusText.innerText = globalProgressInfo.status;

    var progress = document.querySelector("#convert-progress");
    progress.style.display = globalProgressInfo.busy ? "block" : "none";
    progress.value = globalProgressInfo.progress * 100;
}

async function doConvertPDF() {
    var startPage = parseInt(document.querySelector("#min-page-input").value);
    var endPage = parseInt(document.querySelector("#max-page-input").value);
    var recognizeText = document.querySelector("#recognize-text-check").checked;
    var includeHidden = document.querySelector("#hidden-layer-check").checked;

    if (startPage >= endPage) {
        setWarning("The start page number must be lower than the end page number!");
        return;
    }

    await sendMessage({ type: "createPDF", recognizeText, startPage, endPage, includeHidden });
}
