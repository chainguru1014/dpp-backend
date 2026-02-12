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
        const { name, email, password } = req.body;

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
            role: 'User',  // Default role for mobile app users
            isApproved: false
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
            wallet: newUser.wallet
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
