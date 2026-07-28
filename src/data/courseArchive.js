const REPOSITORY_URL = "https://github.com/PhishyOne/Phishtopia.com";
const ARCHIVE_REF = "archive/course-projects-2026-07-28";

function screenshotUrl(path) {
    return `${REPOSITORY_URL}/blob/${ARCHIVE_REF}/${path}?raw=1`;
}

function sourceUrl(path) {
    return `${REPOSITORY_URL}/tree/${ARCHIVE_REF}/${path}`;
}

function project({
    chapter,
    title,
    description,
    originalRoute,
    screenshotPath,
    sourcePath,
    currentPath = null
}) {
    return Object.freeze({
        chapter,
        title,
        description,
        originalRoute,
        screenshot: screenshotUrl(screenshotPath),
        source: sourceUrl(sourcePath),
        currentPath
    });
}

export const COURSE_ARCHIVE = Object.freeze({
    branchUrl: `${REPOSITORY_URL}/tree/${ARCHIVE_REF}`,
    manifestUrl: `${REPOSITORY_URL}/blob/main/docs/course-project-archive.md`,
    backEnd: Object.freeze([
        project({
            chapter: "34",
            title: "Movie Database (YouList)",
            description: "A capstone combining an external movie API, a PostgreSQL database, user accounts, search, and shared comments.",
            originalRoute: "/project34/",
            screenshotPath: "app-brewery-server/public/project34/images/preview.png",
            sourcePath: "app-brewery-server",
            currentPath: "/youlist"
        }),
        project({
            chapter: "33-3",
            title: "To Do List",
            description: "A persistent PostgreSQL to-do list demonstrating create, read, update, and delete operations.",
            originalRoute: "/project33-3/",
            screenshotPath: "app-brewery-server/public/project33-3/preview.png",
            sourcePath: "app-brewery-server"
        }),
        project({
            chapter: "33-2",
            title: "Family Travel Tracker",
            description: "An extension of the travel tracker that lets multiple users maintain separate maps.",
            originalRoute: "/project33-2/",
            screenshotPath: "app-brewery-server/public/project33-2/preview.png",
            sourcePath: "app-brewery-server"
        }),
        project({
            chapter: "33-1",
            title: "Travel Tracker",
            description: "A world travel map backed by a database, with country autocomplete and a custom clear-map control.",
            originalRoute: "/project33-1/",
            screenshotPath: "app-brewery-server/public/project33-1/preview.png",
            sourcePath: "app-brewery-server"
        }),
        project({
            chapter: "30",
            title: "Blog API",
            description: "A server-backed blog interface for viewing, creating, editing, and deleting posts through an API.",
            originalRoute: "/project30/",
            screenshotPath: "app-brewery-server/public/project30/preview.png",
            sourcePath: "app-brewery-server"
        }),
        project({
            chapter: "29",
            title: "EVE Echoes PlayInt",
            description: "An intelligence tool that processed public EVE Echoes killmail data to estimate where and when a player was active.",
            originalRoute: "/project29/",
            screenshotPath: "app-brewery-server/public/project29/images/preview.png",
            sourcePath: "app-brewery-server",
            currentPath: "/echotrace"
        }),
        project({
            chapter: "28",
            title: "Secrets",
            description: "An API exercise covering authenticated requests, tokens, credentials, and retrieving a random anonymous secret.",
            originalRoute: "/project28/",
            screenshotPath: "app-brewery-server/public/project28/preview.png",
            sourcePath: "app-brewery-server"
        }),
        project({
            chapter: "25",
            title: "Band Name Generator",
            description: "My first deployed Node server project, wrapped around a deliberately simple band-name generator.",
            originalRoute: "/project25/",
            screenshotPath: "app-brewery-server/public/project25/preview.png",
            sourcePath: "app-brewery-server"
        })
    ]),
    frontEnd: Object.freeze([
        project({
            chapter: "20",
            title: "Simon",
            description: "A mobile-compatible memory game built with JavaScript events, sound, and an increasingly long color sequence.",
            originalRoute: "/static/20-Simon/",
            screenshotPath: "views/app-brewery-static/20-Simon/preview.png",
            sourcePath: "views/app-brewery-static/20-Simon"
        }),
        project({
            chapter: "18.2",
            title: "Drums Improved",
            description: "A faster version of the drum kit that preloads audio and reuses sound objects instead of recreating them on every hit.",
            originalRoute: "/static/18-2-Drums-Improved/",
            screenshotPath: "views/app-brewery-static/18-2-Drums-Improved/images/preview.png",
            sourcePath: "views/app-brewery-static/18-2-Drums-Improved"
        }),
        project({
            chapter: "18.1",
            title: "Drums",
            description: "A keyboard-and-click drum kit using DOM queries, event listeners, audio, and a switch statement.",
            originalRoute: "/static/18-1-Drums/",
            screenshotPath: "views/app-brewery-static/18-1-Drums/images/preview.png",
            sourcePath: "views/app-brewery-static/18-1-Drums"
        }),
        project({
            chapter: "17",
            title: "Dice Game",
            description: "A two-player dice game with random rolls, a replay button, flexbox layout, and custom typography.",
            originalRoute: "/static/17-Dice-Game/",
            screenshotPath: "views/app-brewery-static/17-Dice-Game/images/preview.png",
            sourcePath: "views/app-brewery-static/17-Dice-Game"
        }),
        project({
            chapter: "13",
            title: "Phishtopia v1.0",
            description: "The first substantial Phishtopia redesign, combining the HTML and CSS skills learned through the course.",
            originalRoute: "/static/13-Phishtopia-v1.0/",
            screenshotPath: "views/app-brewery-static/13-Phishtopia-v1.0/images/preview.png",
            sourcePath: "views/app-brewery-static/13-Phishtopia-v1.0"
        }),
        project({
            chapter: "12",
            title: "Web Design",
            description: "A quick hotel homepage concept created to practice typography, contrast, hierarchy, and visual direction.",
            originalRoute: "External Canva page",
            screenshotPath: "views/app-brewery-static/12-Design/preview.png",
            sourcePath: "views/app-brewery-static/12-Design"
        }),
        project({
            chapter: "11",
            title: "TinDog",
            description: "A responsive dog-dating landing page assembled with Bootstrap sections, components, and layout utilities.",
            originalRoute: "/static/11-TinDog/",
            screenshotPath: "views/app-brewery-static/11-TinDog/images/preview.png",
            sourcePath: "views/app-brewery-static/11-TinDog"
        }),
        project({
            chapter: "10",
            title: "Mondrian Project",
            description: "A from-scratch recreation of a Mondrian-style composition built almost entirely with CSS Grid.",
            originalRoute: "/static/10-Mondrian/",
            screenshotPath: "views/app-brewery-static/10-Mondrian/preview.png",
            sourcePath: "views/app-brewery-static/10-Mondrian"
        }),
        project({
            chapter: "9",
            title: "Pricing Table",
            description: "A responsive three-tier pricing layout made with flexbox that collapses cleanly to one column on mobile.",
            originalRoute: "/static/9-Prices/",
            screenshotPath: "views/app-brewery-static/9-Prices/preview.png",
            sourcePath: "views/app-brewery-static/9-Prices"
        }),
        project({
            chapter: "8",
            title: "Agency Website",
            description: "A responsive agency layout built under strict constraints using floats and block layout rather than flexbox or grid.",
            originalRoute: "/static/8-Agency/",
            screenshotPath: "views/app-brewery-static/8-Agency/assets/images/preview.png",
            sourcePath: "views/app-brewery-static/8-Agency"
        }),
        project({
            chapter: "7",
            title: "Laos Flag",
            description: "A CSS positioning puzzle that constructs the flag of Laos entirely from styled div elements and text.",
            originalRoute: "/static/7-Flag/",
            screenshotPath: "views/app-brewery-static/7-Flag/assets/images/preview.png",
            sourcePath: "views/app-brewery-static/7-Flag"
        }),
        project({
            chapter: "6",
            title: "Motivational Meme",
            description: "An original meme page using custom typography, borders, alignment, transforms, spacing, and a dark background.",
            originalRoute: "/static/6-Meme/",
            screenshotPath: "views/app-brewery-static/6-Meme/assets/images/preview.png",
            sourcePath: "views/app-brewery-static/6-Meme"
        }),
        project({
            chapter: "5",
            title: "Colors in Spanish",
            description: "A basic CSS exercise using tag, class, and ID selectors to control text styling and image dimensions.",
            originalRoute: "/static/5-Spanish-Colors/",
            screenshotPath: "views/app-brewery-static/5-Spanish-Colors/preview.png",
            sourcePath: "views/app-brewery-static/5-Spanish-Colors"
        }),
        project({
            chapter: "4",
            title: "This Page!",
            description: "A simple HTML page demonstrating document structure, images, links, and navigation between pages.",
            originalRoute: "/static/4-This-Page/index.html",
            screenshotPath: "views/app-brewery-static/4-This-Page/preview.png",
            sourcePath: "views/app-brewery-static/4-This-Page"
        }),
        project({
            chapter: "3",
            title: "Birthday Invite",
            description: "An early HTML exercise combining an image with headings, paragraphs, and an unordered list.",
            originalRoute: "/static/3-Birthday/birthday-invite.html",
            screenshotPath: "views/app-brewery-static/3-Birthday/preview.png",
            sourcePath: "views/app-brewery-static/3-Birthday"
        }),
        project({
            chapter: "2",
            title: "Movie Rank",
            description: "My first structured project page, using headings and paragraphs to present a ranked movie list.",
            originalRoute: "/static/2-Movies/movie-rank.html",
            screenshotPath: "views/app-brewery-static/2-Movies/preview.png",
            sourcePath: "views/app-brewery-static/2-Movies"
        })
    ])
});
