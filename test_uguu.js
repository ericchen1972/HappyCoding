const https = require('https');
const fs = require('fs');

const dataBuffer = Buffer.from('test info', 'utf-8');
const ext = 'txt';
const boundary = '----WebKitFormBoundary' + Math.random().toString(36).substring(2);

const postData = Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="files[]"; filename="image.${ext}"\r\nContent-Type: text/plain\r\n\r\n`),
    dataBuffer,
    Buffer.from(`\r\n--${boundary}--\r\n`)
]);

const requestOpts = {
    hostname: 'uguu.se',
    port: 443,
    path: '/upload',
    method: 'POST',
    headers: {
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
        'Content-Length': postData.length,
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Chrome/121.0.0.0 Safari/537.36',
        'Accept': '*/*'
    }
};

const req = https.request(requestOpts, (res) => {
    let body = '';
    res.on('data', (chunk) => body += chunk);
    res.on('end', () => {
        console.log('Status code:', res.statusCode);
        console.log('Response:', body);
    });
});
req.on('error', console.error);
req.write(postData);
req.end();
