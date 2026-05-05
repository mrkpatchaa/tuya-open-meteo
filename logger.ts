// Capture logs so they can be included in notification emails
export const logBuffer: string[] = [];

const originalConsoleLog = console.log;
console.log = (...args: any[]) => {
    const message = args.map(String).join(" ");
    logBuffer.push(message);
    originalConsoleLog(...args);
};
