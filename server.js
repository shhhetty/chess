const express = require('express');
const app = express();
const http = require('http');
const server = http.createServer(app);
const { Server } = require("socket.io");
const io = new Server(server);

app.use(express.static('public'));

io.on('connection', (socket) => {
    console.log('User connected:', socket.id);

    // Join a specific room
    socket.on('join-room', (roomId, userId) => {
        const room = io.sockets.adapter.rooms.get(roomId);
        const numClients = room ? room.size : 0;

        if (numClients === 0) {
            socket.join(roomId);
            socket.emit('player-color', 'w'); // First to join is White
        } else if (numClients === 1) {
            socket.join(roomId);
            socket.emit('player-color', 'b'); // Second to join is Black
            // Notify the first player that opponent is here
            socket.to(roomId).emit('user-connected', userId); 
        } else {
            socket.emit('full-room');
        }
    });

    // Relay chess moves
    socket.on('move', (moveData) => {
        socket.to(moveData.roomId).emit('move', moveData.move);
    });

    // Relay WebRTC Video/Audio signals
    socket.on('signal', (data) => {
        socket.to(data.roomId).emit('signal', data.signal);
    });

    socket.on('disconnect', () => {
        console.log('User disconnected');
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});