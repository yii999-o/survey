const mongoose = require('mongoose');

const userSchema = new mongoose.Schema(
  {
    schemaVersion: { type: Number, default: 1 },
    username: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      minlength: 3,
      maxlength: 32
    },
    passwordHash: { type: String, required: true }
  },
  {
    timestamps: { createdAt: true, updatedAt: false },
    versionKey: false
  }
);

// username 字段上的 unique: true 已创建唯一索引，不再重复声明 schema.index。
module.exports = mongoose.model('User', userSchema);
