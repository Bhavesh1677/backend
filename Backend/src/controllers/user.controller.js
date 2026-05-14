import { ApiResponse } from "../utils/ApiResponse.js";
import { ApiError } from "../utils/ApiError.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { User } from "../models/user.model.js";
import { uploadOnCloudinary } from "../utils/cloudinary.js";
import fs from "fs";

const registerUser = asyncHandler(async (req, res) => {
  // Get user details from request
  const { username, email, fullName, password } = req.body;

  // Validate required fields
  if (
    [username, email, fullName, password].some(
      (field) => !field?.trim()
    )
  ) {
    throw new ApiError(400, "All required fields must be provided");
  }

  // Check if user already exists
  const existingUser = await User.findOne({
    $or: [{ username }, { email }],
  });

  if (existingUser) {
    throw new ApiError(409, "User with this email or username already exists");
  }

  // get local file path
  const avatarLocalPath = req.files?.avatar?.[0]?.path;
  const coverImageLocalPath = req.files?.coverImage?.[0]?.path;

  // check if file path is available 
  if(!avatarLocalPath){
    throw new ApiError(400, "Avatar is required");
  }

  // upload file to cloudinary 
  const avatarUpload = await uploadOnCloudinary(avatarLocalPath)
  const coverImageUpload = await uploadOnCloudinary(coverImageLocalPath)

  // check if file path is available 
  if(!avatarUpload){
    throw new ApiError(400, "Something went wrong while uploading the avatar");
  }

  // Create user
  const user = await User.create({
    username: username.toLowerCase(),
    email,
    fullName,
    password,
    avatar: avatarUpload.url,   
    coverImage: coverImageUpload?.url || "",
  });

  // Fetch created user without password and refreshToken
  const createdUser = await User.findById(user._id).select(
    "-password -refreshToken"
  );

  // check if user created successfully
  if (!createdUser) {
    throw new ApiError(500, "Something went wrong while registering the user");
  }
  // send response
  return res
    .status(201)
    .json(new ApiResponse(201, createdUser, "User registered successfully"));
});

export { registerUser };