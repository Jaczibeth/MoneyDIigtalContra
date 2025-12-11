// Sistema de subida de archivos/evidencias
class FileUploadSystem {
    constructor() {
        this.maxFileSize = 25 * 1024 * 1024; // 25MB
        this.allowedTypes = ['image/jpeg', 'image/png', 'image/gif', 'application/pdf', 'video/mp4', 'video/webm'];
    }

    async uploadFile(file, activityId, studentUsername) {
        return new Promise((resolve, reject) => {
            if (!file) {
                reject(new Error('No se seleccionó ningún archivo'));
                return;
            }

            if (file.size > this.maxFileSize) {
                reject(new Error('El archivo es demasiado grande. Máximo 25MB'));
                return;
            }

            if (!this.allowedTypes.includes(file.type)) {
                reject(new Error('Tipo de archivo no permitido. Use: JPG, PNG, GIF, PDF, MP4'));
                return;
            }

            const reader = new FileReader();
            reader.onload = (e) => {
                const fileData = {
                    name: file.name,
                    type: file.type,
                    size: file.size,
                    data: e.target.result, // Base64
                    uploadedAt: new Date().toISOString()
                };

                // Guardar en localStorage (en producción esto iría a un servidor)
                const fileId = `${activityId}_${studentUsername}_${Date.now()}`;
                localStorage.setItem(`file_${fileId}`, JSON.stringify(fileData));

                resolve({
                    id: fileId,
                    ...fileData
                });
            };

            reader.onerror = () => reject(new Error('Error al leer el archivo'));
            reader.readAsDataURL(file);
        });
    }

    getFile(fileId) {
        try {
            const data = localStorage.getItem(`file_${fileId}`);
            return data ? JSON.parse(data) : null;
        } catch (e) {
            return null;
        }
    }

    downloadFile(fileId, fileName) {
        const fileData = this.getFile(fileId);
        if (!fileData) {
            alert('Archivo no encontrado');
            return;
        }

        const link = document.createElement('a');
        link.href = fileData.data;
        link.download = fileName || fileData.name;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    }

    previewFile(fileId) {
        const fileData = this.getFile(fileId);
        if (!fileData) return null;

        if (fileData.type.startsWith('image/')) {
            return fileData.data; // URL de imagen
        } else if (fileData.type === 'application/pdf') {
            return fileData.data; // URL de PDF
        } else if (fileData.type.startsWith('video/')) {
            return fileData.data; // URL de video
        }

        return null;
    }
}

const fileUploadSystem = new FileUploadSystem();

