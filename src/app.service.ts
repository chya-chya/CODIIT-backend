import { Injectable } from '@nestjs/common';
import * as Sentry from '@sentry/node';
@Injectable()
export class AppService {
  getHello(): string {
    Sentry.captureException(new Error('Sentry test error'));

    return 'Hello World!';
  }
}
