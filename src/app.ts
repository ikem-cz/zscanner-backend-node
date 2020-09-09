import { default as Koa } from 'koa';
import { default as bodyparser } from 'koa-bodyparser';
import { default as json } from 'koa-json';

import { createLogger } from './lib/logging';
import { time, KoaNextFunction } from './lib/utils';
import { newBodyPartsRouter } from './routes/bodyparts';
import { newDocumentsRouter } from './routes/documents';
import { newDocumentTypesRouter } from './routes/documenttypes';
import { newFoldersRouter } from './routes/folders';
import { newHealthCheckRouter } from './routes/healthcheck';
import { newUploadRouter } from './routes/upload';
import {
    Authenticator,
    BodyPartsStorage,
    DocumentStorage,
    MetricsStorage,
    Uploader,
} from './services/types';

export { config } from './lib/config';
export { createLogger } from './lib/logging';
export * from './lib/utils';
export * from './services/types';
export { newNoopAuthenticator } from './services/authenticators/noop';
export { newNoopMetricsStorage } from './services/metrics-storages/noop';
export { newSeacatAuthenticator } from './services/authenticators/seacat';
export { newDemoDocumentStorage } from './services/document-storages/demo';
export { newTusUploader, newTusStore } from './services/uploader/tus-uploader';
export { newDemoBodyPartsStorage } from './services/body-parts-storages/demo';

const onerror = require('koa-onerror');

const LOG = createLogger(__filename);

export function constructKoaApplication({
    authenticator,
    documentStorage,
    metricsStorage,
    uploader,
    bodyPartsStorage,
}: {
    authenticator: Authenticator;
    documentStorage: DocumentStorage;
    metricsStorage: MetricsStorage;
    uploader: Uploader;
    bodyPartsStorage: BodyPartsStorage;
}) {
    const app = new Koa();
    configureMiddleware();
    configureRoutes();
    return app;

    function configureRoutes() {
        const documentsRouter = newDocumentsRouter({
            documentStorage,
            metricsStorage,
            uploader,
        });
        const foldersRouter = newFoldersRouter({
            documentStorage,
            metricsStorage,
        });
        const documentTypesRouter = newDocumentTypesRouter({ documentStorage });
        const healthCheckRouter = newHealthCheckRouter({
            components: [documentStorage, authenticator, metricsStorage],
        });
        const uploadRouter = newUploadRouter({ uploader });
        const bodyPartsRouter = newBodyPartsRouter({ bodyPartsStorage });

        app.use(documentsRouter.routes());
        app.use(foldersRouter.routes());
        app.use(documentTypesRouter.routes());
        app.use(bodyPartsRouter.routes());
        app.use(healthCheckRouter.routes());
        app.use(uploadRouter.routes());
    }

    function configureMiddleware() {
        onerror(app);

        app.use(async function (ctx: Koa.Context, next: KoaNextFunction) {
            if (ctx.request.header['content-type'] === 'application-json') {
                ctx.request.header['content-type'] = 'application/json';
            }
            await next();
        });

        app.use(async function (ctx: Koa.Context, next: KoaNextFunction) {
            if (
                ctx.path.endsWith('/healthcheck') ||
                !ctx.path.startsWith('/api-zscanner') ||
                (await authenticator.authenticate(ctx))
            ) {
                await next();
            } else {
                ctx.response.status = 403;
                ctx.response.message = 'Access Denied';
            }
        });

        app.use(
            bodyparser({
                enableTypes: ['json', 'form', 'text'],
            })
        );
        app.use(json());

        // logger
        app.use(koaLogger());

        // error-handling
        app.on('error', (error, ctx) => {
            LOG.error(`${ctx.method} ${ctx.url} - Error ${error}`, {
                error,
            });
        });
    }

    function koaLogger() {
        return async (ctx: Koa.Context, next: KoaNextFunction) => {
            const ms = (await time(next))[1];
            LOG.debug(
                `${ctx.method} ${ctx.url} - ${
                    ctx.response.status
                } - ${ms.toFixed(3)}ms - ${ctx.response.message}`,
                {
                    method: ctx.method,
                    url: ctx.url,
                    ms,
                    status: ctx.response.status,
                }
            );
        };
    }
}
