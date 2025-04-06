document.addEventListener('DOMContentLoaded', () => {
    const folderInput = document.getElementById('folderInput');
    const cacheFolderButton = document.getElementById('cacheFolderButton');
    const fileList = document.getElementById('fileList');


    const cacheRules = {
        'webllm/config': (filename) => filename === 'mlc-chat-config.json',
        'webllm/model': (filename) => 
            filename === 'ndarray-cache.json' || 
            filename === 'tokenizer.json' || 
            filename.endsWith('.bin'),
        'webllm/wasm': (filename) => filename.endsWith('.wasm')
    };


    function getCacheLocation(filename) {
        for (const [cache, rule] of Object.entries(cacheRules)) {
            if (rule(filename)) return cache;
        }
        return null;
    }

    async function readFileAsArrayBuffer(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result);
            reader.onerror = () => reject(reader.error);
            reader.readAsArrayBuffer(file);
        });
    }

    cacheFolderButton.addEventListener('click', async () => {
        const files = Array.from(folderInput.files);
        
        if (files.length === 0) {
            console.warn('choose a folder');
            return;
        }

        try {
            const totalFiles = files.length;
            let processedFiles = 0;
            const cacheStats = {
                'webllm/config': 0,
                'webllm/model': 0,
                'webllm/wasm': 0,
                'ignored': 0
            };

            console.log(`start retrieve ${totalFiles} file...`);
            fileList.innerHTML = '<h3>cache file list：</h3>';
            const ul = document.createElement('ul');
            fileList.appendChild(ul);

            for (const file of files) {
                try {
                    const relativePath = file.webkitRelativePath;
                    const filename = file.name;
                    const cacheLocation = getCacheLocation(filename);
        
                    if (!cacheLocation) {
                        cacheStats.ignored++;
                        continue;
                    }
        
                    const fileContent = await readFileAsArrayBuffer(file);
                    const cache = await caches.open(cacheLocation);
                    
                    const contentType = filename.endsWith('.bin') ? 
                        'application/octet-stream' : 
                        (file.type || 'application/octet-stream');
        
                    const fileResponse = new Response(fileContent, {
                        headers: {
                            'Content-Type': contentType,
                            'Content-Disposition': `attachment; filename="${filename}"`,
                            'X-File-Name': filename,
                            'X-File-Path': relativePath,
                            'Content-Length': fileContent.byteLength.toString(),
                            'Content-Type': "application/octet-stream",
                            'Response-Type': "cors",
                            'Vary': 'Authorization,Accept-Encoding,Origin' 
                        }
                    });
        
                    const pathParts = relativePath.split('/');
                    const modelName = pathParts[1];
                    const cacheKey = `/mlc-ai/binary-mlc-llm-libs/main/web-llm-models/v0_2_48/${modelName}`;
                    await cache.put(cacheKey, fileResponse);

                    cacheStats[cacheLocation]++;
                    const li = document.createElement('li');
                    li.textContent = `[${cacheLocation}] ${relativePath}`;
                    ul.appendChild(li);

                    processedFiles++;
                    console.log(`Progress: ${processedFiles}/${totalFiles}`);
                } catch (error) {
                    console.error(`error in ${file.name} file:`, error);
                    const li = document.createElement('li');
                    li.textContent = `${file.name} (Fail: ${error.message})`;
                    li.style.color = 'red';
                    ul.appendChild(li);
                }
            }

            const statsMessage = `
Successful retrieve list：
config file: ${cacheStats['webllm/config']}
bin file: ${cacheStats['webllm/model']}
wasm file: ${cacheStats['webllm/wasm']}
skipped: ${cacheStats.ignored}`;

            console.log(statsMessage);
            
            
            const statsDiv = document.createElement('div');
            statsDiv.style.marginTop = '20px';
            statsDiv.style.whiteSpace = 'pre-line';
            statsDiv.textContent = statsMessage;
            fileList.appendChild(statsDiv);

        } catch (error) {
            console.error('error in retrive files:', error);
            const errorDiv = document.createElement('div');
            errorDiv.style.color = 'red';
            errorDiv.textContent = `error：${error.message}`;
            fileList.appendChild(errorDiv);
        }
    });
});