var hiddenLayerShown = false;

window.onload = function () {
    document.querySelector("#hidden-button").addEventListener("click", doShowHiddenLayer);
    document.querySelector("#convert-button").addEventListener("click", doConvertPDF);
    document.querySelector("#advanced-settings-toggle").addEventListener("click", () => {
        var p = document.querySelector("#advanced-settings-collapse");
        if (!p.getAttribute("collapsed")) p.setAttribute("collapsed", true);
        else p.removeAttribute("collapsed");
    });

    chrome.runtime.onMessage.addListener(function (message, sender, sendResponse) {
        if (!("cmsPdf" in message)) return;
        message = message.cmsPdf;

        switch (message.type) {
            case "PDFDone":
                if (message.error) setWarning(`An unexpected error occured: ${message.error}`);
                updateBusy(false);
                sendResponse({ cmsPdf: true });
                return true;
            case "progress":
                document.querySelector("#convert-progress").value = message.progress * 100;
                sendResponse({ cmsPdf: true });
                return true;
        }

        sendResponse({ cmsPdf: null });
        return true;
    });

    sendMessage({ type: "info" }).then((res) => {
        const content = document.querySelector("#content");
        if (res.supported) {
            setWarning(null);
            content.style.display = "block";

            document.querySelector("#page-count-label").innerText = "Page count: " + res.pageCount;
            var minPage = document.querySelector("#min-page-input");
            minPage.max = res.pageCount;
            minPage.value = 1;
            var maxPage = document.querySelector("#max-page-input");
            maxPage.max = res.pageCount;
            maxPage.value = res.pageCount;

            updateBusy(res.busy);
        } else {
            setWarning("This website is not supported.");
            content.style.display = "none";
        }
    });
};

function setWarning(message) {
    var warning = document.querySelector("#warning-unsupported");
    warning.innerText = message;
    warning.style.display = message ? "block" : "none";
}

function sendMessage(message) {
    return new Promise((resolve, reject) => {
        chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
            var tab = tabs[0].id;
            chrome.tabs.sendMessage(tab, { cmsPdf: message }, (res) => {
                if (chrome.runtime.lastError || !res) {
                    // The message was not delivered, inject the scripts that will receive the message
                    chrome.tabs.executeScript(tab, { file: "tesseract.min.js" }, () => {
                        chrome.tabs.executeScript(tab, { file: "jspdf.min.js" }, () => {
                            chrome.tabs.executeScript(tab, { file: "pdfCreation.js" }, () => {
                                chrome.tabs.sendMessage(tab, { cmsPdf: message }, (res) => {
                                    if (chrome.runtime.lastError || !res) {
                                        console.warn("No answer after injecting, this should not happen.");
                                        reject();
                                    } else {
                                        resolve(res.cmsPdf);
                                    }
                                });
                            });
                        });
                    });
                } else {
                    resolve(res.cmsPdf);
                }
            });
        });
    });
}

async function doShowHiddenLayer(ev) {
    hiddenLayerShown = !hiddenLayerShown;
    await sendMessage({ type: "setHiddenLayer", value: hiddenLayerShown });
    ev.target.innerText = !hiddenLayerShown ? "Show hidden layer" : "Hide layer";
}

function updateBusy(busy) {
    document.querySelectorAll(".control").forEach((el) => {
        el.disabled = busy;
    });

    var progress = document.querySelector("#convert-progress");
    progress.value = 50;
    progress.style.display = busy ? "block" : "none";
}

async function doConvertPDF() {
    var startPage = parseInt(document.querySelector("#min-page-input").value);
    var endPage = parseInt(document.querySelector("#max-page-input").value);
    var recognizeText = document.querySelector("#recognize-text-check").checked;
    var includeHidden = document.querySelector("#hidden-layer-check").checked;

    await sendMessage({ type: "createPDF", recognizeText, startPage, endPage, includeHidden });
    updateBusy(true);
}
