import { ApiResponse } from "../utils/ApiResponse.js";
import { ApiError } from "../utils/ApiError.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { User } from "../models/user.model.js";
import { uploadOnCloudinary } from "../utils/cloudinary.js";
import jwt from "jsonwebtoken";

const generateAccessAndRefreshToken = async (userId) => {
  try {
    const user = await User.findById(userId);
    const accessToken = user.generateAccessToken();
    const refreshToken = user.generateRefreshToken();

    user.refreshToken = refreshToken;
    await user.save({ validateBeforeSave: false });
    return { accessToken, refreshToken };
  } catch (error) {
    throw new ApiError(
      500,
      "Something went wrong while generating access and refresh token"
    );
  }
};

const registerUser = asyncHandler(async (req, res) => {
  // Get user details from request
  const { username, email, fullName, password } = req.body;

  // Validate required fields
  if ([username, email, fullName, password].some((field) => !field?.trim())) {
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
  if (!avatarLocalPath) {
    throw new ApiError(400, "Avatar is required");
  }

  // upload file to cloudinary
  const avatarUpload = await uploadOnCloudinary(avatarLocalPath);
  const coverImageUpload = await uploadOnCloudinary(coverImageLocalPath);

  // check if file path is available
  if (!avatarUpload) {
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

const loginUser = asyncHandler(async (req, res) => {
  // get user details from request
  const { email, username, password } = req.body;

  // check if email or username is provided
  if (!email && !username) {
    throw new ApiError(400, "Email or username is required");
  }

  // find user by email or username
  const user = await User.findOne({
    $or: [{ email }, { username }],
  });
  // check if user found
  if (!user) {
    throw new ApiError(401, "User not found");
  }
  // check if password is valid
  const isPasswordValid = await user.isPasswordCorrect(password);

  if (!isPasswordValid) {
    throw new ApiError(401, "Invalid password");
  }

  // generate access and refresh token
  const { accessToken, refreshToken } = await generateAccessAndRefreshToken(
    user._id
  );

  // get user without sensitive info
  const loggedInUser = await User.findById(user._id).select(
    "-password -refreshToken"
  );

  const options = {
    httpOnly: true,
    secure: true,
  };

  return res
    .status(200)
    .cookie("accessToken", accessToken, options)
    .cookie("refreshToken", refreshToken, options)
    .json(
      new ApiResponse(
        200,
        {
          user: loggedInUser,
          accessToken,
          refreshToken,
        },
        "User logged in successfully"
      )
    );
});

const logoutUser = asyncHandler(async (req, res) => {
  await User.findByIdAndUpdate(
    req.user._id,
    {
      $set: {
        refreshToken: undefined,
      },
    },
    {
      new: true,
    }
  );
  const options = {
    httpOnly: true,
    secure: true,
  };
  return res
    .status(200)
    .clearCookie("accessToken", options)
    .clearCookie("refreshToken", options)
    .json(new ApiResponse(200, {}, "User logged out successfully"));
});

const refreshAccessToken = asyncHandler(async (req, res) => {
  const incomingRefreshToken =
    req.cookies.refreshToken || req.body.refreshToken;

  if (!incomingRefreshToken) {
    throw new ApiError(401, "Unauthorized request");
  }

  try {
    const decodedToken = jwt.verify(
      incomingRefreshToken,
      process.env.REFRESH_TOKEN_SECRET
    );

    const user = await User.findById(decodedToken?._id);

    if (!user) {
      throw new ApiError(401, "Invalid refresh token");
    }

    if (user.refreshToken !== incomingRefreshToken) {
      throw new ApiError(401, "Refresh token is used or expired");
    }

    const options = {
      httpOnly: true,
      secure: true,
    };

    const { accessToken, newRefreshToken } =
      await generateAccessAndRefreshToken(user._id);

    return res
      .status(200)
      .cookie("accessToken", accessToken, options)
      .cookie("refreshToken", newRefreshToken, options)
      .json(
        new ApiResponse(
          200,
          {
            accessToken,
            refreshToken: newRefreshToken,
          },
          "Refresh token generated successfully"
        )
      );
  } catch (error) {
    throw new ApiError(401, error?.message || "Invalid refresh token");
  }
});

const changeCurrentPassword = asyncHandler(async (req, res) => {
    const {oldPassword, newPassword, confPassword} = req.body

    // check if password and confirm password are same
    if (newPassword !== confPassword) {
        throw new ApiError(400, "Password and confirm password do not match")
    }
    // check if fields are provided
    if (!oldPassword || !newPassword) {
        throw new ApiError(400, "All fields are required")
    }
    
    const user = await User.findById(req.user._id);

    if (!user) {
        throw new ApiError(404, "User not found")
    }
    
    const isPasswordCorrect = await user.isPasswordCorrect(oldPassword);
    
    if (!isPasswordCorrect) {
        throw new ApiError(401, "Invalid password")
    }
    
    user.password = newPassword;
    await user.save({validateBeforeSave: false});
    
    return res.status(200).json(new ApiResponse(200, {}, "Password changed successfully"));
});

const getCurrentUser = asyncHandler(async (req, res) => {
  return res.status(200).json(new ApiResponse(200, req.user, "User fetched successfully"));
});

const updateAccountDetails = asyncHandler(async (req, res) => {
  const {fullName, email} = req.body;
  
  if(!fullName || !email){
    throw new ApiError(400, "All fields are required")
  }
  
  const user = await User.findByIdAndUpdate(req.user?._id, {$set: {fullName, email}}, {new: true}).select("-password");

  if(!user){
    throw new ApiError(404, "User not found")
  }
  
  return res.status(200).json(new ApiResponse(200, user, "Account details updated successfully"));
});

const updateUserAvatar = asyncHandler(async (req, res) => {
  const avatarLocalPath = req.file?.path;

  //check if avatar path is available
  if(!avatarLocalPath){
    throw new ApiError(400, "Avatar is required")
  }

  //upload on cloudinary
  const avatarUpload = await uploadOnCloudinary(avatarLocalPath);

  //check if avatar uploaded successfully
  if(!avatarUpload.url){
    throw new ApiError(400, "Something went wrong while uploading the avatar")
  }

  const user = await User.findByIdAndUpdate(req.user?._id, {$set: {avatar: avatarUpload.url}}, {new: true}).select("-password")

  return res.status(200).json(new ApiResponse(200, user, "Avatar updated successfully"));
});

const updateUserCoverImage = asyncHandler(async (req, res) => {
  const coverImageLocalPath = req.file?.path;

  //check if cover image path is available
  if(!coverImageLocalPath){
    throw new ApiError(400, "Cover image is required")
  }

  //upload on cloudinary
  const coverImageUpload = await uploadOnCloudinary(coverImageLocalPath);

  //check if avatar uploaded successfully
  if(!coverImageUpload.url){
    throw new ApiError(400, "Something went wrong while uploading the cover image")
  }

  // update cover image
  const user = await User.findByIdAndUpdate(req.user?._id, {$set: {coverImage: coverImageUpload.url}}, {new: true}).select("-password")

  return res.status(200).json(new ApiResponse(200, user, "Cover image updated successfully"));
});

const getUserChannelProfile = asyncHandler(async (req, res) => {
  const {username} = req.params;
  
  if(!username?.trim()){
    throw new ApiError(400, "Username is required")
  }

  const channel = await User.aggregate([
    {
      $match: {
        username: username?.toLowerCase()
      }
    },
    {
      $lookup: {
        from: "subscriptions",
        localField: "_id",
        foreignField: "channel",
        as: "subscribers",
      }
    },
    {
      $lookup: {
        from: "subscriptions",
        localField: "_id",
        foreignField: "subscriber",
        as: "subscribedTo",
      }
    },
    {
      $addFields: {
        subscribersCount: {
          $size: "$subscribers"
        },
        subscribedToCount: {
          $size: "$subscribedTo"
        },
        isSubscribed: {
          if: {$in: [req.user?._id, "$subscribers.subscriber"]},
          then: true,
          else: false
        }
      }
    },
    {
      $project: {
        fullName: 1,
        username: 1,
        avatar: 1,
        coverImage: 1,
        subscribersCount: 1,
        subscribedToCount: 1,
        isSubscribed: 1,
      }
    }
  ])

  if(!channel?.length){
    throw new ApiError(404, "Channel not found")  
  }
  
  return res
  .status(200)
  .json(new ApiResponse(200, channel[0], "Channel profile fetched successfully"))
}); 

const getWatchHistory = asyncHandler(async (req, res) => {
  const user = await User.aggregate([
    {
      $match: {
        _id: new mongoose.Types.ObjectId(req.user?._id)
      }
    },
    {
      $lookup: {
        from: "videos",
        localField: "watchHistory",
        foreignField: "_id",
        as: "watchHistory",
        pipeline: [
          {
            $lookup: {
              from: "users",
              localField: "owner",
              foreignField: "_id",
              as: "owner",
              pipeline: [
                {
                  $project: {
                    fullName: 1,
                    username: 1,
                    avatar: 1,
                    coverImage: 1,
                  }
                }
              ]
            }
          },
          {
            $addFields: {
              owner: {
                $first: "$owner"
              }
            }
          }
        ]
      }
    }
  ])

  return res
  .status(200)
  .json(new ApiResponse(200, user[0]?.watchHistory, "Watch history fetched successfully"));
})

export {
  registerUser,
  loginUser,
  logoutUser,
  refreshAccessToken,
  changeCurrentPassword,
  getCurrentUser,
  updateAccountDetails,
  updateUserAvatar,
  updateUserCoverImage,
  getUserChannelProfile,
  getWatchHistory,
};
