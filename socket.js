import { Server } from "socket.io";
import mongoose from "mongoose";

import { socketMiddleware } from "./src/middlewares/socketMiddleware.js";
import { emitFriendStatus } from "./src/controllers/friendsController.js";
import { joinConvo } from "./src/controllers/conversationController.js";
import { socketSendMessage } from "./src/controllers/messageController.js";

export const initializeSocket = (server) => {
  // creating socket.io instance with enhanced config
  const io = new Server(server, {
    cors: {
      origin: process.env.FRONT_URL || "https://chatdao.vercel.app",
      methods: ["GET", "POST", "OPTIONS"],
      credentials: true,
      allowedHeaders: ["token", "Content-Type", "Authorization"],
    },
    path: "/socket.io",
    transports: ['polling'],  // Start with polling only
    pingInterval: 25000,
    pingTimeout: 20000,
    allowEIO3: true,
    perMessageDeflate: false,
    maxHttpBufferSize: 1e8,
    connectTimeout: 45000
  });

  // Add connection event logging
  io.engine.on("connection_error", (err) => {
    console.log("Connection error:", err.message);
  });

  // socket protect middleware
  io.use(socketMiddleware);

  // socket error middleware with enhanced logging
  io.use((socket, next) => {
    socket.errorHandler = (error) => {
      console.error("Socket error:", error);
      socket.emit("error", { status: "error", message: error });
    };
    next();
  });

  // listen to socket connection
  io.on("connection", async (socket) => {
    try {
      console.log("New client connected:", socket.id);

      const socket_id = socket.id;
      const user = socket.user;
      const user_id = socket.user._id.toString();

      // join user with socket
      socket.join(user_id);

      // set user online
      user.onlineStatus = "online";
      await user.save();

      emitFriendStatus(io, socket, user, "online");
      joinConvo(socket, user_id);

      // Enhanced disconnect handler
      socket.on("disconnect", async () => {
        try {
          user.onlineStatus = "offline";
          await user.save();
          emitFriendStatus(io, socket, user, "offline");
          console.log("Client disconnected:", socket.id);
        } catch (error) {
          console.error("Disconnect error:", error);
        }
      });

      // Enhanced message handling
      socket.on("send_message", async (message) => {
        try {
          const conversation = message.conversation;
          if (!conversation?.users) {
            throw new Error("Invalid conversation object");
          }

          if (message.approach?.toLowerCase() === "optimistic") {
            const msg_id = new mongoose.Types.ObjectId();
            message._id = msg_id;
            await socketSendMessage(socket, user_id, message);
            socket.emit("message_received", message);
          }

          // Emit message to other users
          conversation.users.forEach((user) => {
            if (user._id !== message.sender._id) {
              socket.in(user._id).emit("message_received", message);
            }
          });
        } catch (error) {
          console.error("Message error:", error);
          socket.errorHandler("Error sending message");
        }
      });

      // Enhanced typing handlers
      socket.on("start_typing", (conversation_id) => {
        try {
          if (!conversation_id) throw new Error("Missing conversation ID");
          socket.in(conversation_id).emit("start_typing", {
            typing: true,
            conversation_id: conversation_id,
          });
        } catch (error) {
          console.error("Start typing error:", error);
          socket.errorHandler("Error with typing");
        }
      });

      socket.on("stop_typing", (conversation_id) => {
        try {
          if (!conversation_id) throw new Error("Missing conversation ID");
          socket.in(conversation_id).emit("stop_typing", {
            typing: false,
            conversation_id: conversation_id,
          });
        } catch (error) {
          console.error("Stop typing error:", error);
          socket.errorHandler("Error with typing");
        }
      });

    } catch (error) {
      console.error("Connection handler error:", error);
      socket.disconnect(true);
    }
  });

  return io;
};