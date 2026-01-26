/**
 * AttachImage Tool - Load an image from disk and convert to WebP for model input
 */

import { stat } from 'fs/promises';
import { basename, extname, resolve } from 'path';
import type { ToolDefinition, ToolResult, ToolExecutionContext } from './base-tool.js';

const SUPPORTED_EXTENSIONS = new Set([
  '.avif',
  '.bmp',
  '.gif',
  '.heic',
  '.heif',
  '.jpeg',
  '.jpg',
  '.png',
  '.tif',
  '.tiff',
  '.webp'
]);

export const AttachImageToolDefinition: ToolDefinition = {
  type: "function",
  function: {
    name: "attach_image",
    description: "Load a local image file (within the working directory), convert it to WebP, and attach it for the next model call.",
    parameters: {
      type: "object",
      properties: {
        explanation: {
          type: "string",
          description: "Why this image is needed"
        },
        file_path: {
          type: "string",
          description: "Path to the image file (relative to workspace or absolute within workspace)"
        }
      },
      required: ["explanation", "file_path"]
    }
  }
};

export async function executeAttachImageTool(
  args: { file_path: string; explanation: string },
  context: ToolExecutionContext
): Promise<ToolResult> {
  if (!context.isPathSafe(args.file_path)) {
    return {
      success: false,
      error: `Access denied: Path is outside the working directory (${context.cwd})`
    };
  }

  try {
    const fullPath = resolve(context.cwd, args.file_path);
    const stats = await stat(fullPath);
    if (!stats.isFile()) {
      return {
        success: false,
        error: `Not a file: ${args.file_path}`
      };
    }

    const ext = extname(fullPath).toLowerCase();
    if (!SUPPORTED_EXTENSIONS.has(ext)) {
      return {
        success: false,
        error: `Unsupported image type: ${ext || 'unknown'}`
      };
    }

    const sharpModule = await import('sharp');
    const sharp = (sharpModule as any).default ?? sharpModule;
    const image = sharp(fullPath, { failOnError: false });
    const metadata = await image.metadata();
    const webpBuffer = await image.webp({ quality: 70, effort: 4 }).toBuffer();
    const dataUrl = `data:image/webp;base64,${webpBuffer.toString('base64')}`;
    const fileName = basename(fullPath);
    const dimensions = metadata.width && metadata.height
      ? `${metadata.width}x${metadata.height}`
      : 'unknown size';
    const sizeKb = Math.max(1, Math.round(webpBuffer.length / 1024));

    return {
      success: true,
      output: `Attached image ${fileName} (${dimensions}, ${sizeKb} KB WebP)`,
      data: {
        dataUrl,
        mime: 'image/webp',
        fileName,
        byteLength: webpBuffer.length,
        originalByteLength: stats.size
      }
    };
  } catch (error: any) {
    return {
      success: false,
      error: `Failed to attach image: ${error.message}`
    };
  }
}
