import { randomBytes } from 'crypto';
import { createReadStream, lstatSync, readFileSync } from 'fs';
import { createServer, type RequestListener } from 'http';
import { resolve } from 'path';

const CHUNK_SIZE = 1e5; // 100KB
const videoPath = resolve('./data/video.mp4');
const homePage = readFileSync(resolve('./src/web/index.html'));

const handler: RequestListener = (req, res) => {
    if (req.url === '/') {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        return res.end(homePage);
    }

    if (req.url === '/video') {
        if (
            !req.headers.range ||
            !/^bytes=(\d*-\d*,?)+$/.test(req.headers.range)
        ) {
            res.writeHead(416);
            return res.end('Range Not Satisfiable');
        }

        const videoSize = lstatSync(videoPath).size;
        const ranges = req.headers.range
            .replace(/bytes=/, '')
            .split(',')
            .map(range => {
                const [startStr, endStr] = range.split('-');
                const start = Number(startStr ?? 0);
                const end = Math.min(
                    endStr ? Number(endStr) : start + CHUNK_SIZE - 1,
                    videoSize - 1
                );

                if (start >= videoSize || end >= videoSize || start > end) {
                    res.writeHead(416);
                    res.end('Range Not Satisfiable');
                    throw new Error('Range Not Satisfiable');
                }

                return { start, end };
            });

        if (!ranges.length) {
            res.writeHead(416);
            return res.end('Range Not Satisfiable');
        }

        if (ranges.length === 1) {
            const [{ start, end }] = ranges;
            res.writeHead(206, {
                'Content-Range': `bytes ${start}-${end}/${videoSize}`,
                'Accept-Ranges': 'bytes',
                'Content-Length': end - start + 1,
                'Content-Type': 'video/mp4'
            });

            const videoStream = createReadStream(videoPath, {
                start,
                end: end + 1
            });
            return videoStream.pipe(res);
        } else {
            const boundary = randomBytes(16).toString('hex');

            res.writeHead(206, {
                'Content-Type': `multipart/byteranges; boundary=${boundary}`,
                'Accept-Ranges': 'bytes'
            });

            for (const { start, end } of ranges) {
                res.write(`--${boundary}\r\n`);
                res.write('Content-Type: video/mp4\r\n');
                res.write(
                    `Content-Range: bytes ${start}-${end}/${videoSize}\r\n`
                );
                res.write(`Content-Length: ${end - start + 1}\r\n\r\n`);

                const videoStream = createReadStream(videoPath, {
                    start,
                    end: end + 1
                });
                videoStream.pipe(res, { end: false });
                videoStream.on('end', () => {
                    res.write('\r\n');
                    if (ranges.indexOf({ start, end }) === ranges.length - 1) {
                        res.write(`--${boundary}--\r\n`);
                        res.end();
                    }
                });
            }
        }
    }

    res.writeHead(404);
    res.end('Not Found');
};

const app = createServer(handler);

app.listen(3000, () => console.log('Server running on http://localhost:3000'));
