const express = require('express');
const path = require('path');
const cors = require('cors');
const app = express();
const port = 5050; 

// setting CORS
// app.use(cors({
//     origin: 'http://localhost:8888',
//     methods: ['GET', 'POST', 'OPTIONS'],
//     allowedHeaders: ['Content-Type', 'Authorization']
// }));

app.use(cors({
    origin: ['https://deep.cs.cityu.edu.hk/:8000','http://127.0.0.1:8000','http://localhost:8000'],
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization']
}));

app.use('/models/Llama-3.2-1B-Instruct-q4f16_1-MLC/resolve/main/', express.static('./models/Llama-3.2-1B-Instruct-q4f16_1-MLC/'));
app.use('/models/Llama-3.2-3B-Instruct-q4f16_1-MLC/resolve/main/', express.static('./models/Llama-3.2-3B-Instruct-q4f16_1-MLC/'));
app.use('/models/DeepSeek-R1-Distill-Llama-8B-q4f16_1-MLC/resolve/main/', express.static('./models/DeepSeek-R1-Distill-Llama-8B-q4f16_1-MLC/'));
app.use('/models/Qwen2.5-Coder-0.5B-Instruct-q4f16_1-MLC/resolve/main/', express.static('./models/Qwen2.5-Coder-0.5B-Instruct-q4f16_1-MLC/'));
app.use('/models/Qwen2.5-Coder-3B-Instruct-q4f16_1-MLC/resolve/main/', express.static('./models/Qwen2.5-Coder-3B-Instruct-q4f16_1-MLC/'));
app.use('/models/Qwen2.5-Coder-7B-Instruct-q4f16_1-MLC/resolve/main/', express.static('./models/Qwen2.5-Coder-7B-Instruct-q4f16_1-MLC/'));


app.use('/libs/', express.static('./libs/'));


app.get('/', (req, res) => {
    res.send('Hello World!');
});

app.listen(port, () => {
    console.log(`Server running at http://https://deep.cs.cityu.edu.hk:${port}`);
});