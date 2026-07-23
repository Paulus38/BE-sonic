import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    const firestoreHint = this.firestoreSetupHint(exception);

    let status =
      exception instanceof HttpException
        ? exception.getStatus()
        : HttpStatus.INTERNAL_SERVER_ERROR;
    let message = 'Internal server error';

    if (firestoreHint) {
      status = HttpStatus.SERVICE_UNAVAILABLE;
      message = firestoreHint;
    } else {
      const exceptionResponse =
        exception instanceof HttpException ? exception.getResponse() : null;

      if (typeof exceptionResponse === 'string') {
        message = exceptionResponse;
      } else if (
        exceptionResponse &&
        typeof exceptionResponse === 'object' &&
        'message' in exceptionResponse
      ) {
        const raw = (exceptionResponse as { message: string | string[] })
          .message;
        message = Array.isArray(raw) ? raw.join(', ') : raw;
      } else if (exception instanceof Error) {
        // Surface operational errors (STT/AI/storage) instead of opaque 500.
        message = exception.message.slice(0, 500) || message;
        // Multer size / unexpected upload errors
        const code =
          'code' in exception
            ? String((exception as { code?: string }).code ?? '')
            : '';
        if (code === 'LIMIT_FILE_SIZE') {
          status = HttpStatus.BAD_REQUEST;
          message = 'File audio vượt giới hạn upload (tối đa 50MB)';
        } else if (
          /Unsupported audio|Định dạng audio không hỗ trợ/i.test(message)
        ) {
          status = HttpStatus.BAD_REQUEST;
        }
      }
    }

    if (status >= 500) {
      this.logger.error(
        `${request.method} ${request.url}`,
        exception instanceof Error ? exception.stack : String(exception),
      );
    }

    response.status(status).json({
      success: false,
      statusCode: status,
      message,
      path: request.url,
      timestamp: new Date().toISOString(),
    });
  }

  private firestoreSetupHint(exception: unknown): string | null {
    const code =
      exception && typeof exception === 'object' && 'code' in exception
        ? Number((exception as { code: unknown }).code)
        : undefined;
    const msg = exception instanceof Error ? exception.message : String(exception);
    if (code === 5 || /5 NOT_FOUND/i.test(msg) || /NOT_FOUND:\s*$/i.test(msg)) {
      return (
        'Firestore database chưa được tạo trên project sonic-27ed5. ' +
        'Mở https://console.firebase.google.com/project/sonic-27ed5/firestore ' +
        '→ Create database (Native mode) → rồi đăng ký/đăng nhập lại.'
      );
    }
    if (/bucket does not exist/i.test(msg) || /billing account/i.test(msg)) {
      return (
        'Firebase Storage chưa sẵn sàng (bucket/billing). ' +
        'Mở https://console.firebase.google.com/project/sonic-27ed5/storage → Get started. ' +
        'Có thể cần bật Blaze billing. Hiện BE sẽ fallback local nếu STORAGE_ALLOW_LOCAL_FALLBACK=true.'
      );
    }
    return null;
  }
}
