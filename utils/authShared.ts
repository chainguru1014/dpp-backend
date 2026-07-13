const jwt = require('jsonwebtoken');
const { claimEmailHoldings } = require('./ownership');

/**
 * Claim any product holdings that were transferred to this user's email address
 * while they were unregistered (Email-kind holdings). Called on every successful
 * authentication path (login/register/OTP/Google/Apple) so a receiver owns
 * transferred products the moment they authenticate with the matching email.
 * Never blocks authentication if claiming fails.
 */
const claimHoldingsForUser = async (user: any) => {
    try {
        await claimEmailHoldings(user);
    } catch (err) {
        console.error('claimEmailHoldings failed:', err);
    }
};

// Shape returned for any authenticated User-kind actor. Kept stable across
// login/register/google/apple/otp so clients have one response shape to parse.
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

// Parallel shape for a Company-kind actor (brand/admin accounts), returned when
// the find-or-link-or-create algorithm resolves an email to an existing Company
// instead of a User. Never used to CREATE a Company — only to authenticate one.
const buildCompanyResponse = (company: any) => ({
    _id: company._id,
    name: company.name,
    email: company.email,
    avatar: company.avatar,
    role: company.role,
    wallet: company.wallet,
    title: company.title,
    logo: company.logo,
    background: company.background,
    detail: company.detail,
    location: company.location,
    isVerified: company.isVerified
});

/**
 * Sign a JWT for an authenticated actor. Fails fast if JWT_SECRET is unset
 * rather than silently falling back to an insecure default — a startup check
 * in app.ts also refuses to boot without JWT_SECRET, so this should never
 * actually throw in a running process, but guards direct/test invocation too.
 */
const signJwt = (payload: any) => {
    if (!process.env.JWT_SECRET) {
        throw new Error('JWT_SECRET is required');
    }
    return jwt.sign(payload, process.env.JWT_SECRET, {
        expiresIn: process.env.JWT_EXPIRES_IN || '1d'
    });
};

module.exports = {
    claimHoldingsForUser,
    buildUserResponse,
    buildCompanyResponse,
    signJwt
};
