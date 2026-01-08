const express = require('express');
const app = express();
const http = require('http');
const server = http.createServer(app);
const { Server } = require("socket.io");
const io = new Server(server);

app.use(express.static('public'));

const rooms = {};

io.on('connection', (socket) => {
    console.log('New connection:', socket.id);

    // Create Room
    socket.on('create-room', (roomId, timeControl) => {
        if (rooms[roomId]) {
            socket.emit('room-error', 'Room already exists');
            return;
        }
        
        rooms[roomId] = { 
            timeControl: parseInt(timeControl),
            players: 1 
        };
        
        socket.join(roomId);
        // CHANGE: Send color, but don't expect client to render yet
        socket.emit('player-color', 'w'); 
        // Send init signal
        socket.emit('game-init', { time: rooms[roomId].timeControl, color: 'w' });
    });

    // Join Room
    socket.on('join-room', (roomId) => {
        const room = io.sockets.adapter.rooms.get(roomId);
        
        if (!room || room.size === 0 || !rooms[roomId]) {
            socket.emit('room-error', 'Room does not exist');
            return;
        }

        if (room.size >= 2) {
            socket.emit('room-error', 'Room is full');
            return;
        }

        socket.join(roomId);
        rooms[roomId].players = 2;
        
        // Notify Joiner
        socket.emit('player-color', 'b'); 
        socket.emit('game-init', { time: rooms[roomId].timeControl, color: 'b' });

        // Notify Creator
        socket.to(roomId).emit('user-connected', socket.id);
    });

    socket.on('move', (data) => {
        socket.to(data.roomId).emit('move', data.move);
    });

    socket.on('signal', (data) => {
        socket.to(data.roomId).emit('signal', data.signal);
    });

    socket.on('timer-sync', (data) => {
        socket.to(data.roomId).emit('timer-update', data);
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
