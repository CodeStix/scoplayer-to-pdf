<img align="right" src="https://github.com/CodeStix/scoplayer-to-pdf/blob/master/images/icon128.png">

# scoplayer-to-pdf

My school uses a non-standard PDF viewer that does not allow pdf downloading. The viewer they use (SmartSCOPlayer) also contains leaked workbook solutions. This **chrome extension** is made to convert these documents to PDF and also to show solutions.
Every page is downloaded as an image when viewing the document, to be able to search through the generated PDF, this tool also includes an experimental image to text recognizer (tesseract.js) which allows you to <kbd>Ctrl</kbd>+<kbd>F</kbd> after convertion.

## Installation

1. Download this repo with _Clone or download_, and unpack the downloaded zip.
2. Navigate to `chrome://extensions`
3. Enable developer mode in the top right corner.
4. Use _Load unpacked extension_ to select the unpacked folder you downloaded at step 1.
5. Navigate to a PDF viewer and press the extension icon at the top right.

## Features

![The menu](https://github.com/CodeStix/scoplayer-to-pdf/blob/master/images/menu.png)

## Support

Currently, only **SmartSCOPlayer** is supported:

![SmartSCOPlayer looks like this](https://github.com/CodeStix/scoplayer-to-pdf/blob/master/images/example.png)
![SmartSCOPlayer looks like this](https://github.com/CodeStix/scoplayer-to-pdf/blob/master/images/example2.png)

You can request support for another viewer by opening an issue or pull request.
