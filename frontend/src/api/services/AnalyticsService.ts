/* generated using openapi-typescript-codegen -- do not edit */
import type { CancelablePromise } from '../core/CancelablePromise';
import { OpenAPI } from '../core/OpenAPI';
import { request as __request } from '../core/request';

export class AnalyticsService {
    public static uploadBulkAnalyticsUploadBulkPost(
        file: Blob,
    ): CancelablePromise<any> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/analytics/upload-bulk',
            formData: {
                'file': file,
            },
        });
    }

    public static processHtListAnalyticsProcessHtListPost(): CancelablePromise<any> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/analytics/process-ht-list',
        });
    }

    public static getHtListInfoAnalyticsHtListInfoGet(): CancelablePromise<any> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/analytics/ht-list-info',
        });
    }

    public static processUploadedList(file: Blob, identifyColumn?: string | null): CancelablePromise<any> {
        const formData: any = { file }
        if (identifyColumn !== undefined && identifyColumn !== null) {
            formData.identify_column = identifyColumn
        }
        return __request(OpenAPI, {
            method: 'POST',
            url: '/analytics/process-uploaded-list',
            formData,
        });
    }
}
