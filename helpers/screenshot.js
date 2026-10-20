import allureReporter from '@wdio/allure-reporter';
/**
 * Capture and attach a screenshot to Allure report
 * @param {string} name - The name of the screenshot/step
 */
export async function attachScreenshotFn(name = "Screenshot") {
    try {
        const screenshot = await browser.takeScreenshot();
        allureReporter.addAttachment(
            name,
            Buffer.from(screenshot, 'base64'),
            'image/png'
        );
        console.log(`📸 Screenshot attached: ${name}`);
    } catch (err) {
        console.warn(`⚠️ Failed to capture screenshot for: ${name}`, err);
    }
}

export function attachText(name, text) {
    try {
        allureReporter.addAttachment(name, text, 'text/plain');
        console.log(`✅ Text attached: ${name}`);
    } catch (err) {
        console.error(`❌ Failed to attach text: ${name}`, err);
    }
}
