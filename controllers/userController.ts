const User = require('../models/userModel');
const Company = require('../models/companyModel');
const AppError = require('../utils/appError');
const jwt = require('jsonwebtoken');

const normalizeUsername = (value: any) => (typeof value === 'string' ? value.trim() : '');

const findExistingNormalUserByName = async (name: string) => {
    if (!name) {
        return null;
    }
    return User.findOne({
        role: 'User',
        userType: { $in: ['client', 'agent'] },
        name: { $regex: `^${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, $options: 'i' }
    });
};

const buildUserResponse = (user: any) => ({
    _id: user._id,
    name: user.name,
    email: user.email,
    avatar: user.avatar,
    role: user.role,
    wallet: user.wallet,
    userType: user.userType,
    gender: user.gender,
    age: user.age,
    country: user.country,
    firstName: user.firstName,
    lastName: user.lastName,
    dateOfBirth: user.dateOfBirth,
    address: user.address,
    addressStreet: user.addressStreet,
    addressCity: user.addressCity,
    addressState: user.addressState,
    addressZipCode: user.addressZipCode,
    addressCountry: user.addressCountry,
    phoneNumber: user.phoneNumber,
    profileCompleted: user.profileCompleted
});

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

        const userData = buildUserResponse(user);

        res.status(200).json({
            status: 'success',
            token,
            user: userData
        });
    } catch (error) {
        next(error);
    }
};

exports.checkUsername = async (req: any, res: any, next: any) => {
    try {
        const name = normalizeUsername(req.body?.name);

        if (!name) {
            return res.status(400).json({
                status: 'fail',
                message: 'Please provide username'
            });
        }

        const existingUser = await findExistingNormalUserByName(name);
        return res.status(200).json({
            status: 'success',
            exists: !!existingUser
        });
    } catch (error) {
        next(error);
    }
};

// Mobile app register endpoint - uses User table
exports.register = async (req: any, res: any, next: any) => {
    try {
        const {
            name,
            email,
            password,
            userType = 'client',
            gender,
            age,
            country,
            firstName,
            lastName,
            addressStreet,
            addressCity,
            addressState,
            addressZipCode,
            addressCountry,
            phoneNumber,
            dateOfBirth
        } = req.body;

        const normalizedName = normalizeUsername(name);

        if (!normalizedName || !password) {
            return res.status(400).json({
                status: 'fail',
                message: 'Please provide username and password'
            });
        }

        if (userType === 'client') {
            if (!gender || !age || !country) {
                return res.status(400).json({
                    status: 'fail',
                    message: 'Client requires gender, age, and country'
                });
            }
        } else if (userType === 'agent') {
            if (!email || !firstName || !lastName || !addressStreet || !addressCity || !addressState || !addressZipCode || !addressCountry || !phoneNumber || !gender || !dateOfBirth) {
                return res.status(400).json({
                    status: 'fail',
                    message: 'Agent requires email, first name, last name, street, city, state, zip code, country, phone number, gender, and date of birth'
                });
            }
        } else {
            return res.status(400).json({
                status: 'fail',
                message: 'Invalid user type'
            });
        }

        const existingUserByName = await findExistingNormalUserByName(normalizedName);
        if (existingUserByName) {
            return res.status(400).json({
                status: 'fail',
                message: 'User with this name or email already exists'
            });
        }

        const duplicateQuery: any[] = [];
        if (email) {
            duplicateQuery.push({ email });
        }

        const existingUser = duplicateQuery.length
            ? await User.findOne({
                role: 'User',
                $or: duplicateQuery
            })
            : null;

        if (existingUser) {
            return res.status(400).json({
                status: 'fail',
                message: 'User with this name or email already exists'
            });
        }

        // Create new user in User collection (for mobile app)
        const newUser = await User.create({
            name: normalizedName,
            email,
            password,
            userType,
            gender,
            age,
            country,
            firstName,
            lastName,
            addressStreet,
            addressCity,
            addressState,
            addressZipCode,
            addressCountry,
            address: `${addressStreet}, ${addressCity}, ${addressState}, ${addressZipCode}, ${addressCountry}`,
            phoneNumber,
            dateOfBirth,
            role: 'User',
            isApproved: false,
            profileCompleted: true
        });

        // Generate JWT token
        const token = jwt.sign(
            { id: newUser._id, name: newUser.name },
            process.env.JWT_SECRET || 'default-secret',
            { expiresIn: process.env.JWT_EXPIRES_IN || '1d' }
        );

        const userData = buildUserResponse(newUser);

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
                password: 'google'
            });
        }

        // Generate JWT token
        const token = jwt.sign(
            { id: user._id, name: user.name },
            process.env.JWT_SECRET || 'default-secret',
            { expiresIn: process.env.JWT_EXPIRES_IN || '1d' }
        );

        const userData = buildUserResponse(user);

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
        const { userId, userType, username, gender, age, country } = req.body;

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

        if (!username || !gender || !age || !country) {
            return res.status(400).json({
                status: 'fail',
                message: 'Please provide username, gender, age, and country'
            });
        }

        user.name = username;
        user.userType = userType || 'client';
        user.gender = gender;
        user.age = age;
        user.country = country;
        user.profileCompleted = true;
        await user.save();

        // Generate new JWT token
        const token = jwt.sign(
            { id: user._id, name: user.name },
            process.env.JWT_SECRET || 'default-secret',
            { expiresIn: process.env.JWT_EXPIRES_IN || '1d' }
        );

        const userData = buildUserResponse(user);

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

// Update profile endpoint for mobile app profile edit page
exports.updateProfile = async (req: any, res: any, next: any) => {
    try {
        const { userType } = req.body;
        const updateData: any = {};

        if (!userType || !['client', 'agent'].includes(userType)) {
            return res.status(400).json({
                status: 'fail',
                message: 'Invalid user type'
            });
        }

        if (userType === 'client') {
            const { name, password, gender, age, country } = req.body;
            if (!name || !password || !gender || !age || !country) {
                return res.status(400).json({
                    status: 'fail',
                    message: 'Client requires username, password, gender, age, and country'
                });
            }
            updateData.name = name;
            updateData.password = password;
            updateData.gender = gender;
            updateData.age = age;
            updateData.country = country;
            updateData.firstName = undefined;
            updateData.lastName = undefined;
            updateData.address = undefined;
            updateData.addressStreet = undefined;
            updateData.addressCity = undefined;
            updateData.addressState = undefined;
            updateData.addressZipCode = undefined;
            updateData.addressCountry = undefined;
            updateData.phoneNumber = undefined;
            updateData.dateOfBirth = undefined;
        } else {
            const {
                name,
                email,
                firstName,
                lastName,
                addressStreet,
                addressCity,
                addressState,
                addressZipCode,
                addressCountry,
                phoneNumber,
                gender,
                dateOfBirth,
                password
            } = req.body;
            if (!name || !email || !firstName || !lastName || !addressStreet || !addressCity || !addressState || !addressZipCode || !addressCountry || !phoneNumber || !gender || !dateOfBirth) {
                return res.status(400).json({
                    status: 'fail',
                    message: 'Agent requires username, email, first name, last name, street, city, state, zip code, country, phone number, gender, and date of birth'
                });
            }
            updateData.name = name;
            updateData.email = email;
            updateData.firstName = firstName;
            updateData.lastName = lastName;
            updateData.addressStreet = addressStreet;
            updateData.addressCity = addressCity;
            updateData.addressState = addressState;
            updateData.addressZipCode = addressZipCode;
            updateData.addressCountry = addressCountry;
            updateData.address = `${addressStreet}, ${addressCity}, ${addressState}, ${addressZipCode}, ${addressCountry}`;
            updateData.phoneNumber = phoneNumber;
            updateData.gender = gender;
            updateData.dateOfBirth = dateOfBirth;
            if (password) {
                updateData.password = password;
            }
            updateData.age = undefined;
            updateData.country = undefined;
        }

        updateData.userType = userType;
        updateData.profileCompleted = true;

        const user = await User.findByIdAndUpdate(req.params.id, updateData, {
            new: true,
            runValidators: true
        });

        if (!user) {
            return res.status(404).json({
                status: 'fail',
                message: 'User not found'
            });
        }

        const token = jwt.sign(
            { id: user._id, name: user.name },
            process.env.JWT_SECRET || 'default-secret',
            { expiresIn: process.env.JWT_EXPIRES_IN || '1d' }
        );

        res.status(200).json({
            status: 'success',
            token,
            user: buildUserResponse(user),
            message: 'Profile updated successfully'
        });
    } catch (error) {
        next(error);
    }
};
