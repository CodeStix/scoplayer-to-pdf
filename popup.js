var hiddenLayerShown = false;

window.onload = function () {
    document.querySelector("#hidden-button").addEventListener("click", doShowHiddenLayer);
    document.querySelector("#convert-button").addEventListener("click", doConvertPDF);
    document.querySelector("#advanced-settings-toggle").addEventListener("click", () => {
        var p = document.querySelector("#advanced-settings-collapse");
        if (!p.hasAttribute("collapsed")) p.setAttribute("collapsed", true);
        else p.removeAttribute("collapsed");
    });

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

async function doShowHiddenLayer(ev) {
    hiddenLayerShown = !hiddenLayerShown;
    const res = await sendMessage({ type: "setHiddenLayer", value: hiddenLayerShown });
    if (!res) {
        hiddenLayerShown = false;
        setWarning("This page does not have a hidden layer.");
    }
    ev.target.innerText = !hiddenLayerShown ? "Show hidden layer" : "Hide layer";
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
