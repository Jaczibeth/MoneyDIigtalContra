// Sistema de subida de archivos/evidencias usando IndexedDB (Memoria del Navegador)
// No requiere instalación de BD ni servidor backend. Todo vive en el cliente.
class FileUploadSystem {
    constructor() {
        this.maxFileSize = 25 * 1024 * 1024; // 25MB
        this.allowedTypes = ['image/jpeg', 'image/png', 'image/gif', 'application/pdf', 'video/mp4', 'video/webm'];
        this.dbName = 'MoneyDigitalDB';
        this.storeName = 'files';
        this.initDB();
    }

    initDB() {
        return new Promise((resolve, reject) => {
            const request = indexedDB.open(this.dbName, 1);
            request.onerror = (e) => console.error('IndexedDB error:', e);
            request.onupgradeneeded = (e) => {
                const db = e.target.result;
                if (!db.objectStoreNames.contains(this.storeName)) {
                    db.createObjectStore(this.storeName, { keyPath: 'id' });
                }
            };
            request.onsuccess = (e) => resolve(e.target.result);
        });
    }

    async getDB() {
        return new Promise((resolve, reject) => {
            const request = indexedDB.open(this.dbName, 1);
            request.onsuccess = (e) => resolve(e.target.result);
            request.onerror = (e) => reject(e);
        });
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
            reader.onload = async (e) => {
                const fileId = `${activityId}_${studentUsername}_${Date.now()}`;
                const fileData = {
                    id: fileId,
                    name: file.name,
                    type: file.type,
                    size: file.size,
                    data: e.target.result, // Base64
                    uploadedAt: new Date().toISOString()
                };

                try {
                    const db = await this.getDB();
                    const tx = db.transaction(this.storeName, 'readwrite');
                    const store = tx.objectStore(this.storeName);
                    store.put(fileData);

                    tx.oncomplete = () => {
                        resolve({
                            id: fileId,
                            name: fileData.name,
                            type: fileData.type,
                            size: fileData.size
                        });
                    };
                    tx.onerror = () => reject(new Error('Error guardando en memoria del navegador'));
                } catch (dbError) {
                    reject(new Error('Error de base de datos local: ' + dbError.message));
                }
            };

            reader.onerror = () => reject(new Error('Error al leer el archivo'));
            reader.readAsDataURL(file);
        });
    }

    async getFile(fileId) {
        return new Promise(async (resolve, reject) => {
            try {
                const db = await this.getDB();
                const tx = db.transaction(this.storeName, 'readonly');
                const store = tx.objectStore(this.storeName);
                const request = store.get(fileId);

                request.onsuccess = () => resolve(request.result || null);
                request.onerror = () => resolve(null);
            } catch (e) {
                resolve(null);
            }
        });
    }

    async downloadFile(fileId, fileName) {
        const fileData = await this.getFile(fileId);
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
}

const fileUploadSystem = new FileUploadSystem();

