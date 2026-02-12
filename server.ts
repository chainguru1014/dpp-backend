const mongoose = require('mongoose');
const dotenv = require('dotenv');
dotenv.config({
    path: './.env'
});

process.on('uncaughtException', err => {
    console.log('UNCAUGHT EXCEPTION!!! shutting down...');
    console.log(err.name, err.message);
    process.exit(1);
});

const app = require('./app');

// Ensure uploads directory exists on startup
const fs = require('fs');
const path = require('path');
const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir, { recursive: true });
    console.log('Created uploads directory:', uploadsDir);
}


mongoose.connect(process.env.DATABASE,
    (err: any) => {
        if(err) throw err;
        console.log('connected to MongoDB')
    });
mongoose.connection.on('connected', () => {
    console.log('Connected to MongoDB');
});
mongoose.connection.on('error', (error: any) => {
    console.log(error);
});
// Start the server
const port = process.env.PORT || 8080;
const server = app.listen(port, "0.0.0.0", () => {
    console.log(`Application is running on port ${port}`);
});

const { Server } = require('socket.io');

const socketIo = new Server(server, {
    cors : {
        origin : '*'
    }
})

// @ts-ignore
global.io = socketIo;

socketIo.on('connection', (socket: any) => {
    console.log('A user connected');
  
    socket.on('disconnect', () => {
      console.log('User disconnected');
    });
  
    socket.on('message', (data: any) => {
      console.log('Received message:', data);
      socketIo.emit('message', data); // Broadcast message to all connected clients
    });
});

process.on('unhandledRejection', (err: any) => {
    console.log('UNHANDLED REJECTION!!!  shutting down ...');
    console.log(err.name, err.message);
    app.close(() => {
        process.exit(1);
    });
});