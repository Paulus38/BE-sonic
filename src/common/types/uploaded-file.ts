/**
 * In-memory Multer upload shape used by Nest FileInterceptor.
 * Avoids relying on Express.Multer global augmentation (@types/multer).
 */
export type MulterFile = {
  fieldname: string;
  originalname: string;
  encoding: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
  destination?: string;
  filename?: string;
  path?: string;
};
