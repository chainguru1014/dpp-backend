class AppError extends Error {
    statusCode: any;
    status: any;

    constructor(statusCode: any, status: any, message: any) {
        super(message);
        this.statusCode = statusCode;
        this.status = status;
        this.message = message;
    }
}

module.exports = AppError;