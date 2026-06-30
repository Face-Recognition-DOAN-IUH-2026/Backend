"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CloudinaryService = void 0;
const cloudinary_1 = require("cloudinary");
const config_1 = require("../config");
cloudinary_1.v2.config({
    cloud_name: config_1.config.cloudinary.cloudName,
    api_key: config_1.config.cloudinary.apiKey,
    api_secret: config_1.config.cloudinary.apiSecret,
});
class CloudinaryService {
    async uploadAvatar(userId, buffer, mimeType) {
        return new Promise((resolve, reject) => {
            const uploadStream = cloudinary_1.v2.uploader.upload_stream({
                folder: 'avatars',
                public_id: userId,
                resource_type: 'image',
                overwrite: true,
            }, (error, result) => {
                if (error)
                    reject(error);
                else
                    resolve(result.secure_url);
            });
            uploadStream.end(buffer);
        });
    }
    async deleteAvatar(userId) {
        try {
            await cloudinary_1.v2.uploader.destroy(`avatars/${userId}`, { resource_type: 'image' });
        }
        catch {
            // ignore if file doesn't exist
        }
    }
}
exports.CloudinaryService = CloudinaryService;
