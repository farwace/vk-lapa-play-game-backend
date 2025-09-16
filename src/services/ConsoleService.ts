class ConsoleService {
    private isProd: boolean;

    constructor() {
        this.isProd = process.env.NODE_ENV === "production";
    }

    log(...args: unknown[]): void {
        if (!this.isProd) {
            console.log(...args);
        }
    }

    error(...args: unknown[]): void {
        if (!this.isProd) {
            console.error(...args);
        }
    }

    warn(...args: unknown[]): void {
        if (!this.isProd) {
            console.warn(...args);
        }
    }

    info(...args: unknown[]): void {
        if (!this.isProd) {
            console.info(...args);
        }
    }
}

export default new ConsoleService();