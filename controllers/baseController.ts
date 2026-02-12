const AppError = require('../utils/appError');
const APIFeatures = require('../utils/apiFeatures');
const path  = require('path');
const sharp = require('sharp');

export const deleteOne = (Model: any) => async(req: any, res: any, next: any) => {
    try {
        const doc = await Model.findByIdAndDelete(req.params.id);

        if (!doc) {
            return next(new AppError(404, 'fail', 'No document found with that id'), req, res, next);
        }

        res.status(200).json({
            status: 'success',
            data: null
        });
    } catch (error) {
        next(error);
    }
};

export const updateOne = (Model: any) => async(req: any, res: any, next: any) => {
    try {
        const doc = await Model.findByIdAndUpdate(req.params.id, req.body, {
            new: true,
            runValidators: true
        });

        if (!doc) {
            return next(new AppError(404, 'fail', 'No document found with that id'), req, res, next);
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

export const createOne = (Model: any) => async(req: any, res: any, next: any) => {
    try {
        const doc = await Model.create(req.body);

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

export const getOne = (Model: any) => async(req: any, res: any, next: any) => {
    try {
        const doc = await Model.findById(req.params.id);

        if (!doc) {
            return next(new AppError(404, 'fail', 'No document found with that id'), req, res, next);
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

export const getAll = (Model: any) => async(req: any, res: any, next: any) => {
    try {
        const doc = await Model.find(req.body);
        
        console.log('get');
        res.status(200).json({
            status: 'success',
            results: doc.length,
            data: {
                data: doc
            }
        });
        
    } catch (error) {
        next(error);
    }

};