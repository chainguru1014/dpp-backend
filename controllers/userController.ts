const User = require('../models/userModel');
const Company = require('../models/companyModel');
const AppError = require('../utils/appError');
const jwt = require('jsonwebtoken');

/**
 * Admin-only endpoint that returns all users and companies.
 * Supports optional status filter: 'approved' | 'waiting'.
 * NOTE: Authentication/authorization is expected to be handled at a higher layer.
 */
exports.getAdminUserData = async (req: any, res: any, next: any) => {
    try {
        const status = req.query.status;

        const userFilter: any = {};
        if (status === 'approved') userFilter.isApproved = true;
        if (status === 'waiting') userFilter.isApproved = false;

        const users = await User.find(userFilter).sort({ isApproved: -1 });
        const companies = await Company.find().sort({ isVerified: -1 });

        res.status(200).json({
            status: 'success',
            results: {
                users: users.length,
                companies: companies.length
            },
            data: {
                users,
                companies
            }
        });
    } catch (error) {
        next(error);
    }
};

exports.approveUser = async (req: any, res: any, next: any) => {
    try {
        const doc = await User.findByIdAndUpdate(
            req.params.id,
            { isApproved: true },
            { new: true, runValidators: true }
        );

        if (!doc) {
            return next(new AppError(404, 'fail', 'No user found with that id'), req, res, next);
        }

        res.status(200).json({
            status: 'success',
            data: {
                doc
            }
        });
    } catch (error) {
        next(error);
    }
};

exports.deleteUser = async (req: any, res: any, next: any) => {
    try {
        const doc = await User.findByIdAndDelete(req.params.id);

        if (!doc) {
            return next(new AppError(404, 'fail', 'No user found with that id'), req, res, next);
        }

        res.status(204).json({
            status: 'success',
            data: null
        });
    } catch (error) {
        next(error);
    }
};

exports.updateUser = async (req: any, res: any, next: any) => {
    try {
        const doc = await User.findByIdAndUpdate(req.params.id, req.body, {
            new: true,
            runValidators: true
        });

        if (!doc) {
            return next(new AppError(404, 'fail', 'No user found with that id'), req, res, next);
        }

        res.status(200).json({
            status: 'success',
            data: {
                doc
            }
        });
    } catch (error) {
        next(error);
    }
};

// Mobile app login endpoint - uses User table
exports.login = async (req: any, res: any, next: any) => {
    try {
        const { name, password } = req.body;

        if (!name || !password) {
            return res.status(400).json({
                status: 'fail',
                message: 'Please provide name and password'
            });
        }

        // Find user in User collection (for mobile app users)
        const user = await User.findOne({ name, password });

        if (!user) {
            return res.status(401).json({
                status: 'fail',
                message: 'Invalid credentials'
            });
        }

        // Generate JWT token
        const token = jwt.sign(
            { id: user._id, name: user.name },
            process.env.JWT_SECRET || 'default-secret',
            { expiresIn: process.env.JWT_EXPIRES_IN || '1d' }
        );

        // Remove sensitive data
        const userData = {
            _id: user._id,
            name: user.name,
            email: user.email,
            avatar: user.avatar,
            role: user.role,
            wallet: user.wallet
        };

        res.status(200).json({
            status: 'success',
            token,
            user: userData
        });
    } catch (error) {
        next(error);
    }
};

// Mobile app register endpoint - uses User table
exports.register = async (req: any, res: any, next: any) => {
    try {
        const { name, email, password, userType } = req.body;

        if (!name || !email || !password) {
            return res.status(400).json({
                status: 'fail',
                message: 'Please provide name, email, and password'
            });
        }

        // Check if user already exists in User collection
        const existingUser = await User.findOne({ 
            $or: [{ name }, { email }] 
        });

        if (existingUser) {
            return res.status(400).json({
                status: 'fail',
                message: 'User with this name or email already exists'
            });
        }

        // Create new user in User collection (for mobile app)
        const newUser = await User.create({
            name,
            email,
            password,
            userType: userType || 'client',
            role: 'User',  // Default role for mobile app users
            isApproved: false,
            profileCompleted: false
        });

        // Generate JWT token
        const token = jwt.sign(
            { id: newUser._id, name: newUser.name },
            process.env.JWT_SECRET || 'default-secret',
            { expiresIn: process.env.JWT_EXPIRES_IN || '1d' }
        );

        // Remove sensitive data
        const userData = {
            _id: newUser._id,
            name: newUser.name,
            email: newUser.email,
            avatar: newUser.avatar,
            role: newUser.role,
            wallet: newUser.wallet,
            userType: newUser.userType
        };

        res.status(201).json({
            status: 'success',
            token,
            user: userData,
            message: 'User registered successfully'
        });
    } catch (error) {
        next(error);
    }
};

// Google OAuth login endpoint
exports.googleLogin = async (req: any, res: any, next: any) => {
    try {
        const { accessToken } = req.body;

        if (!accessToken) {
            return res.status(400).json({
                status: 'fail',
                message: 'Please provide Google access token'
            });
        }

        // Verify Google token and get user info
        const googleResponse = await fetch(`https://www.googleapis.com/oauth2/v2/userinfo?access_token=${accessToken}`);
        
        if (!googleResponse.ok) {
            return res.status(401).json({
                status: 'fail',
                message: 'Invalid Google access token'
            });
        }

        const googleUser = await googleResponse.json();

        // Check if user already exists
        let user = await User.findOne({ email: googleUser.email });

        if (user) {
            // Update Google ID if not set
            if (!user.googleId) {
                user.googleId = googleUser.id;
                user.isGoogleUser = true;
                await user.save();
            }
        } else {
            // Create new user from Google account
            user = await User.create({
                name: googleUser.name || googleUser.email.split('@')[0],
                email: googleUser.email,
                avatar: googleUser.picture,
                googleId: googleUser.id,
                isGoogleUser: true,
                userType: 'client', // Default to client
                role: 'User',
                isApproved: false,
                profileCompleted: false,
                password: '' // No password for Google users
            });
        }

        // Generate JWT token
        const token = jwt.sign(
            { id: user._id, name: user.name },
            process.env.JWT_SECRET || 'default-secret',
            { expiresIn: process.env.JWT_EXPIRES_IN || '1d' }
        );

        // Remove sensitive data
        const userData = {
            _id: user._id,
            name: user.name,
            email: user.email,
            avatar: user.avatar,
            role: user.role,
            wallet: user.wallet,
            userType: user.userType,
            profileCompleted: user.profileCompleted
        };

        res.status(200).json({
            status: 'success',
            token,
            user: userData,
            message: user.profileCompleted ? 'Login successful' : 'Profile completion required'
        });
    } catch (error) {
        next(error);
    }
};

// Complete Google profile endpoint
exports.completeGoogleProfile = async (req: any, res: any, next: any) => {
    try {
        const { userId, userType, username, gender, age, country, email, firstName, lastName, dateOfBirth, address } = req.body;

        if (!userId) {
            return res.status(400).json({
                status: 'fail',
                message: 'User ID is required'
            });
        }

        const user = await User.findById(userId);

        if (!user) {
            return res.status(404).json({
                status: 'fail',
                message: 'User not found'
            });
        }

        // Update user profile based on user type
        if (userType === 'client') {
            if (!username || !gender || !age || !country) {
                return res.status(400).json({
                    status: 'fail',
                    message: 'Please provide all required fields for client'
                });
            }
            user.name = username;
            user.gender = gender;
            user.age = age;
            user.country = country;
        } else if (userType === 'agent') {
            if (!email || !firstName || !lastName || !dateOfBirth || !address || !gender) {
                return res.status(400).json({
                    status: 'fail',
                    message: 'Please provide all required fields for agent'
                });
            }
            user.email = email;
            user.firstName = firstName;
            user.lastName = lastName;
            user.dateOfBirth = dateOfBirth;
            user.address = address;
            user.gender = gender;
        }

        user.userType = userType;
        user.profileCompleted = true;
        await user.save();

        // Generate new JWT token
        const token = jwt.sign(
            { id: user._id, name: user.name },
            process.env.JWT_SECRET || 'default-secret',
            { expiresIn: process.env.JWT_EXPIRES_IN || '1d' }
        );

        // Remove sensitive data
        const userData = {
            _id: user._id,
            name: user.name,
            email: user.email,
            avatar: user.avatar,
            role: user.role,
            wallet: user.wallet,
            userType: user.userType,
            profileCompleted: user.profileCompleted
        };

        res.status(200).json({
            status: 'success',
            token,
            user: userData,
            message: 'Profile completed successfully'
        });
    } catch (error) {
        next(error);
    }
};
