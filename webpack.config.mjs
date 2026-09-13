import * as fs from 'fs'
import * as path from 'path'
import { fileURLToPath } from 'url'
import wp from 'webpack'
import { AngularWebpackPlugin } from '@ngtools/webpack'
import { createEs2015LinkerPlugin } from '@angular/compiler-cli/linker/babel'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const linkerPlugin = createEs2015LinkerPlugin({
    linkerJitMode: true,
    fileSystem: {
        resolve: path.resolve,
        exists: fs.existsSync,
        dirname: path.dirname,
        relative: path.relative,
        readFile: fs.readFileSync,
    },
})

const isDev = !!process.env.TABBY_DEV

// Component-scoped styles are converted to strings (for `styleUrls`);
// everything else is injected globally with style-loader.
const componentScssPattern = /\.component\.scss$/

const sassLoader = {
    loader: 'sass-loader',
    options: { api: 'modern-compiler' },
}

export default {
    target: 'node',
    entry: './src/index.ts',
    context: __dirname,
    devtool: false,
    output: {
        path: path.resolve(__dirname, 'dist'),
        filename: 'index.js',
        pathinfo: true,
        libraryTarget: 'umd',
        publicPath: 'auto',
    },
    mode: isDev ? 'development' : 'production',
    optimization: {
        minimize: false,
    },
    cache: !isDev ? false : {
        type: 'filesystem',
        cacheDirectory: path.resolve(__dirname, 'node_modules', '.webpack-cache'),
    },
    resolve: {
        modules: ['.', 'src', 'node_modules'].map(x => path.join(__dirname, x)),
        extensions: ['.ts', '.js'],
        mainFields: ['esm2015', 'browser', 'module', 'main'],
    },
    ignoreWarnings: [/Failed to parse source map/],
    module: {
        rules: [
            {
                test: /\.js$/,
                enforce: 'pre',
                use: {
                    loader: 'source-map-loader',
                    options: {
                        filterSourceMappingUrl: (url, resourcePath) => !/node_modules/.test(resourcePath),
                    },
                },
            },
            {
                test: /\.(m?)js$/,
                loader: 'babel-loader',
                options: {
                    plugins: [linkerPlugin],
                    compact: false,
                    cacheDirectory: true,
                },
                resolve: {
                    fullySpecified: false,
                },
            },
            {
                test: /\.ts$/,
                use: [{ loader: '@ngtools/webpack' }],
            },
            {
                test: /\.html$/,
                type: 'asset/source',
            },
            {
                test: /\.md$/,
                type: 'asset/source',
            },
            {
                test: /\.scss$/,
                use: ['@tabby-gang/to-string-loader', 'css-loader', sassLoader],
                include: componentScssPattern,
            },
            {
                test: /\.scss$/,
                use: ['style-loader', 'css-loader', sassLoader],
                exclude: componentScssPattern,
            },
        ],
    },
    externals: [
        '@electron/remote',
        'child_process',
        'electron',
        'fs',
        'http',
        'https',
        'net',
        'os',
        'path',
        'stream',
        'url',
        'zlib',
        /^@angular(?!\/common\/locales)/,
        /^@ng-bootstrap/,
        /^rxjs/,
        /^tabby-/,
    ],
    plugins: [
        new wp.SourceMapDevToolPlugin({
            exclude: [/node_modules/, /vendor/],
            filename: '[file].map',
            moduleFilenameTemplate: 'webpack-tabby-ai-panel:///[resource-path]',
        }),
        new AngularWebpackPlugin({
            tsconfig: path.resolve(__dirname, 'tsconfig.json'),
            directTemplateLoading: false,
            jitMode: true,
        }),
    ],
}
