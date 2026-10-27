// src/lib/api/attachments.ts — files attached to a record. Bytes live in the
// family's encrypted blob store; these endpoints carry the link and metadata.
import api from './client';
import type { AttachmentMeta } from './types';

export const attachmentsAPI = {
  upload: (refType: string, refId: number, file: File) => {
    const form = new FormData();
    form.set('refType', refType);
    form.set('refId', String(refId));
    form.set('file', file);
    // Content-Type must be unset so the browser adds the multipart boundary;
    // the instance default of application/json makes the API reject the body.
    return api.post<{ attachment: AttachmentMeta }>(
      '/attachments',
      form,
      { headers: { 'Content-Type': undefined } },
    );
  },
  list: (refType: string, refId: number) =>
    api.get<{ attachments: AttachmentMeta[] }>(
      `/attachments?refType=${encodeURIComponent(refType)}&refId=${refId}`,
    ),
  /**
   * Every attachment for a member in one request, so the activity history can
   * show files inline without a request per row. Group the result by
   * `refType:refId` to place each file under its record.
   */
  listForMember: (memberId: number) =>
    api.get<{ attachments: AttachmentMeta[] }>(`/attachments?memberId=${memberId}`),
  remove: (id: number) => api.delete(`/attachments/${id}`),
  /**
   * The decrypted bytes, fetched through the authenticated axios client.
   * A plain <img src> or <a href> cannot load one: the browser sends no
   * Authorization header on those, so the API answers 401 instead of bytes.
   */
  file: (id: number) => api.get(`/attachments/${id}/file`, { responseType: 'blob' }),
  /** Same-origin URL for the decrypted bytes, for callers that hold a token. */
  fileUrl: (id: number) => `/api/v1/attachments/${id}/file`,
};
