const express = require('express');
const app = express();
const http = require('http');
const server = http.createServer(app);
const { Server } = require("socket.io");
const io = new Server(server);

app.use(express.static('public'));

const rooms = {};

io.on('connection', (socket) => {
    
    // Create Room
    socket.on('create-room', (data) => {
        const { roomId, timeControl, name } = data;
        if (rooms[roomId]) return socket.emit('room-error', 'Room exists');
        
        rooms[roomId] = { 
            timeControl: parseInt(timeControl),
            players: 1,
            whiteName: name,
            blackName: null
        };
        socket.join(roomId);
        socket.emit('player-color', 'w'); 
        socket.emit('game-init', { 
            time: rooms[roomId].timeControl, 
            color: 'w',
            oppName: 'Waiting...'
        });
    });

    // Join Room
    socket.on('join-room', (data) => {
        const { roomId, name } = data;
        const room = io.sockets.adapter.rooms.get(roomId);
        if (!room || !rooms[roomId] || room.size >= 2) return socket.emit('room-error', 'Invalid Room');

        socket.join(roomId);
        rooms[roomId].players = 2;
        rooms[roomId].blackName = name;
        
        // Notify Joiner (Black)
        socket.emit('player-color', 'b'); 
        socket.emit('game-init', { 
            time: rooms[roomId].timeControl, 
            color: 'b',
            oppName: rooms[roomId].whiteName
        });

        // Notify Creator (White) that opponent is ready
        socket.to(roomId).emit('opponent-joined', { name: name });
    });

    // Video Signaling (Relay)
    socket.on('signal', (data) => socket.to(data.roomId).emit('signal', data.signal));

    // Game Logic (Relay)
    socket.on('move', (data) => socket.to(data.roomId).emit('move', data.move));
    socket.on('timer-sync', (data) => socket.to(data.roomId).emit('timer-update', data));
    
    socket.on('resign', (roomId) => io.in(roomId).emit('game-over', { reason: 'resign', loser: socket.id }));
    
    socket.on('rematch', (roomId) => io.in(roomId).emit('rematch-start', { time: rooms[roomId].timeControl }));

    socket.on('disconnect', () => {});
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
