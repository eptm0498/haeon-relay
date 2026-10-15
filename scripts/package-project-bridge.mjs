import {readFileSync,writeFileSync} from 'node:fs';
import {deflateRawSync} from 'node:zlib';
const names=['manifest.json','app-bridge.js','background.js','capture.js','README.txt'];
function crc32(bytes){let crc=0xffffffff;for(const byte of bytes){crc^=byte;for(let i=0;i<8;i++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);}return (crc^0xffffffff)>>>0;}
const local=[],central=[];let offset=0;
for(const name of names){
 const filename=Buffer.from(name),data=readFileSync(new URL('../extensions/jiwoo-project-bridge/'+name,import.meta.url));
 const compressed=deflateRawSync(data),crc=crc32(data),header=Buffer.alloc(30),directory=Buffer.alloc(46);
 header.writeUInt32LE(0x04034b50,0);header.writeUInt16LE(20,4);header.writeUInt16LE(0x800,6);header.writeUInt16LE(8,8);header.writeUInt16LE(33,12);header.writeUInt32LE(crc,14);header.writeUInt32LE(compressed.length,18);header.writeUInt32LE(data.length,22);header.writeUInt16LE(filename.length,26);
 directory.writeUInt32LE(0x02014b50,0);directory.writeUInt16LE(20,4);directory.writeUInt16LE(20,6);directory.writeUInt16LE(0x800,8);directory.writeUInt16LE(8,10);directory.writeUInt16LE(33,14);directory.writeUInt32LE(crc,16);directory.writeUInt32LE(compressed.length,20);directory.writeUInt32LE(data.length,24);directory.writeUInt16LE(filename.length,28);directory.writeUInt32LE(offset,42);
 local.push(header,filename,compressed);central.push(directory,filename);offset+=header.length+filename.length+compressed.length;
}
const directory=Buffer.concat(central),end=Buffer.alloc(22);end.writeUInt32LE(0x06054b50,0);end.writeUInt16LE(names.length,8);end.writeUInt16LE(names.length,10);end.writeUInt32LE(directory.length,12);end.writeUInt32LE(offset,16);
writeFileSync(new URL('../public/jiwoo-project-bridge.zip',import.meta.url),Buffer.concat([...local,directory,end]));
console.log('JIWOO_BRIDGE_PACKAGE_OK',names.length);
