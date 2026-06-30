const http = require('http');
const data = JSON.stringify({barcode:'LIB9780142437230020'});
const token = process.argv[2];
const req = http.request({
  hostname:'localhost',
  port:8000,
  path:'/borrow/',
  method:'POST',
  headers:{
    'Content-Type':'application/json',
    'Content-Length':Buffer.byteLength(data),
    'Authorization':'Bearer '+token
  }
}, (res) => {
  let b='';
  res.on('data',c=>b+=c);
  res.on('end',()=>console.log(res.statusCode, b));
});
req.write(data);
req.end();
