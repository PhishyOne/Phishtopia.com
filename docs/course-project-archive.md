# Course-project archive

The original App Brewery course projects are no longer part of the active Phishtopia runtime. Their complete pre-cleanup source and assets are preserved on [`archive/course-projects-2026-07-28`](https://github.com/PhishyOne/Phishtopia.com/tree/archive/course-projects-2026-07-28).

This document preserves the titles, descriptions, screenshots, original routes, and source locations recorded by the former course-progress page. Screenshots are loaded directly from the archive branch rather than copied into the production tree.

## Back-end projects

### Chapter 34 - Movie Database (YouList)

**Original route:** `/project34/`

This project took me a while to complete, but I'm proud of the result! Here, users can search for tv shows and movies and add their comments to a shared list. This was a capstone project, tying together external api integration, database management, and user authentication (which I'll be learning about next chapter).

[View screenshot](https://github.com/PhishyOne/Phishtopia.com/blob/archive/course-projects-2026-07-28/app-brewery-server/public/project34/images/preview.png?raw=1) · [View archived source](https://github.com/PhishyOne/Phishtopia.com/tree/archive/course-projects-2026-07-28/app-brewery-server)

### Chapter 33-3 - To Do List

**Original route:** `/project33-3/`

For my next trick, I used each method of CRUD (Create, Read, Update, Delete) to make a simple to do list that will not erase after a refresh. This list is stored in a PostgreSQL database, so have fun and add as many (shared) items as you'd like.

[View screenshot](https://github.com/PhishyOne/Phishtopia.com/blob/archive/course-projects-2026-07-28/app-brewery-server/public/project33-3/preview.png?raw=1) · [View archived source](https://github.com/PhishyOne/Phishtopia.com/tree/archive/course-projects-2026-07-28/app-brewery-server)

### Chapter 33-2 - Family Travel Tracker

**Original route:** `/project33-2/`

This was just an extension of the previous project, allowing multiple users to track their travels.

[View screenshot](https://github.com/PhishyOne/Phishtopia.com/blob/archive/course-projects-2026-07-28/app-brewery-server/public/project33-2/preview.png?raw=1) · [View archived source](https://github.com/PhishyOne/Phishtopia.com/tree/archive/course-projects-2026-07-28/app-brewery-server)

### Chapter 33-1 - Travel Tracker

**Original route:** `/project33-1/`

This was a pretty neat project for a user to track their travels around the world. I demonstrate my ability to access a database to send and receive data. I also went the extra mile and added a clear button for the map and autocomplete for the input box.

[View screenshot](https://github.com/PhishyOne/Phishtopia.com/blob/archive/course-projects-2026-07-28/app-brewery-server/public/project33-1/preview.png?raw=1) · [View archived source](https://github.com/PhishyOne/Phishtopia.com/tree/archive/course-projects-2026-07-28/app-brewery-server)

### Chapter 30 - Blog API

**Original route:** `/project30/`

Here, I create a server to allow users to look at, add, modify, or delete blog posts. Once again, the hardest part of this project was integrating it into this server as a router after it was originally completed.

[View screenshot](https://github.com/PhishyOne/Phishtopia.com/blob/archive/course-projects-2026-07-28/app-brewery-server/public/project30/preview.png?raw=1) · [View archived source](https://github.com/PhishyOne/Phishtopia.com/tree/archive/course-projects-2026-07-28/app-brewery-server)

### Chapter 29 - Capstone Project - Eve Echoes PlayInt

**Original route:** `/project29/`

Now I get to have some fun! I constructed an Eve Echoes intelligence-gathering web application using the public API provided by echoes.mobi. The user enters a player's name and the application retrieves timestamps and locations from kill/loss-mails. This data is then processed and displayed as places and times most likely to find the player.

[View screenshot](https://github.com/PhishyOne/Phishtopia.com/blob/archive/course-projects-2026-07-28/app-brewery-server/public/project29/images/preview.png?raw=1) · [View archived source](https://github.com/PhishyOne/Phishtopia.com/tree/archive/course-projects-2026-07-28/app-brewery-server)

### Chapter 28 - Secrets

**Original route:** `/project28/`

Interacting with other servers' API's was interesting, but only a fraction of what I learned is put on display here. Using the given setup, users retrieve a random secret from the app brewery server. However, I also learned how to create, modify, ane delete information using the API documentation from another server. I also learned how to generate and maintain actual backend secrets like usernames and passwords, bearer tokens, and API keys, but there was no opportunity to display any of this here.

[View screenshot](https://github.com/PhishyOne/Phishtopia.com/blob/archive/course-projects-2026-07-28/app-brewery-server/public/project28/preview.png?raw=1) · [View archived source](https://github.com/PhishyOne/Phishtopia.com/tree/archive/course-projects-2026-07-28/app-brewery-server)

### Chapter 25 - Band Name Generator

**Original route:** `/project25/`

This was a lot more work than it appears. I set up a server with Heroku, changed the structure of this site for compatibility, and successfully deployed the previous projects on github pages and this project on Heroku. Oh and made a band name generator...almost forgot.

[View screenshot](https://github.com/PhishyOne/Phishtopia.com/blob/archive/course-projects-2026-07-28/app-brewery-server/public/project25/preview.png?raw=1) · [View archived source](https://github.com/PhishyOne/Phishtopia.com/tree/archive/course-projects-2026-07-28/app-brewery-server)

## Front-end projects

### Chapter 20 - Simon

**Original route:** `/static/20-Simon/`

You may remember this game from your childhood. The user has to watch buttons light up and reproduce the correct order by pressing the buttons. I used everything I've learned in JS except (surprisingly) loops to make this game to the course specs, which admittedly leaves much room for improvement. Nonetheless, it's simply a demonstration of my growing skills. Edit: I went back and made this mobile compatible.

[View screenshot](https://github.com/PhishyOne/Phishtopia.com/blob/archive/course-projects-2026-07-28/views/app-brewery-static/20-Simon/preview.png?raw=1) · [View archived source](https://github.com/PhishyOne/Phishtopia.com/tree/archive/course-projects-2026-07-28/views/app-brewery-static/20-Simon)

### Chapter 18.2 - Drums Improved

**Original route:** `/static/18-2-Drums-Improved/`

I wasn't satisfied with the unpolished version of the drum kit that was supposed to be completed in this lesson. I knew there must be a more efficient way to load the sounds ahead of time and to avoid creating a new audio object whenever a sound was played. So here I simplify my code and got help from AI to learn how to preload sounds. It works noticibly faster in rendering sounds.

[View screenshot](https://github.com/PhishyOne/Phishtopia.com/blob/archive/course-projects-2026-07-28/views/app-brewery-static/18-2-Drums-Improved/images/preview.png?raw=1) · [View archived source](https://github.com/PhishyOne/Phishtopia.com/tree/archive/course-projects-2026-07-28/views/app-brewery-static/18-2-Drums-Improved)

### Chapter 18.1 - Drums

**Original route:** `/static/18-1-Drums/`

Here I use JS queries, event listeners for keypresses and clicks, and a switch to call various drum sounds when the user clicks the corresponding drum.

[View screenshot](https://github.com/PhishyOne/Phishtopia.com/blob/archive/course-projects-2026-07-28/views/app-brewery-static/18-1-Drums/images/preview.png?raw=1) · [View archived source](https://github.com/PhishyOne/Phishtopia.com/tree/archive/course-projects-2026-07-28/views/app-brewery-static/18-1-Drums)

### Chapter 17 - Dice Game

**Original route:** `/static/17-Dice-Game/`

After a week or two to train up on JavaScript, I'm ready to begin applying it to the web. I made a dice game where two players compete to roll the highest and added a button to run it for extra credit. Just to show I haven't forgotten how to use HTML and CSS, I used things like flexbox and a custom font to make the page a little less boring. Give it a try!

[View screenshot](https://github.com/PhishyOne/Phishtopia.com/blob/archive/course-projects-2026-07-28/views/app-brewery-static/17-Dice-Game/images/preview.png?raw=1) · [View archived source](https://github.com/PhishyOne/Phishtopia.com/tree/archive/course-projects-2026-07-28/views/app-brewery-static/17-Dice-Game)

### Chapter 13 - Capstone - My Own Site

**Original route:** `/static/13-Phishtopia-v1.0/`

This project showcases my knowledge of the combination of HTML and CSS. I redesigned Phishtopia to reflect my progress with a major update of the entire page.

[View screenshot](https://github.com/PhishyOne/Phishtopia.com/blob/archive/course-projects-2026-07-28/views/app-brewery-static/13-Phishtopia-v1.0/images/preview.png?raw=1) · [View archived source](https://github.com/PhishyOne/Phishtopia.com/tree/archive/course-projects-2026-07-28/views/app-brewery-static/13-Phishtopia-v1.0)

### Chapter 12 - Web Design

**Original route:** external Canva page

I quickly created a hotel home page. I put something together but honestly didn't showcase what I learned. There should be more contrast in the title, serif and sans-serif should be mixed in title and subheading, and additional pages could have been added on. The purpose of my negligence is to show that in 20 minutes, I can make something decent enough to get started with an idea.

[View screenshot](https://github.com/PhishyOne/Phishtopia.com/blob/archive/course-projects-2026-07-28/views/app-brewery-static/12-Design/preview.png?raw=1) · [View archived source](https://github.com/PhishyOne/Phishtopia.com/tree/archive/course-projects-2026-07-28/views/app-brewery-static/12-Design)

### Chapter 11 - TinDog

**Original route:** `/static/11-TinDog/`

I created a landing page for a dog dating app using Bootstrap. The page includes several sections which precisely replicates the goal image primarily using bootstrap for modified snippets and examples. Things are starting to come together to look like a real page.

[View screenshot](https://github.com/PhishyOne/Phishtopia.com/blob/archive/course-projects-2026-07-28/views/app-brewery-static/11-TinDog/images/preview.png?raw=1) · [View archived source](https://github.com/PhishyOne/Phishtopia.com/tree/archive/course-projects-2026-07-28/views/app-brewery-static/11-TinDog)

### Chapter 10 - Mondrian Project

**Original route:** `/static/10-Mondrian/`

My task here was to replicate Mondrian's artwork using grid, almost exclusively and from scratch.

[View screenshot](https://github.com/PhishyOne/Phishtopia.com/blob/archive/course-projects-2026-07-28/views/app-brewery-static/10-Mondrian/preview.png?raw=1) · [View archived source](https://github.com/PhishyOne/Phishtopia.com/tree/archive/course-projects-2026-07-28/views/app-brewery-static/10-Mondrian)

### Chapter 9 - Pricing Table

**Original route:** `/static/9-Prices/`

Matching the goal visually and functionally, I made a three-part table using flexbox. This table includes item title, price, description, a button, and background. The table is adaptive to screen size and switches to a single column on mobile.

[View screenshot](https://github.com/PhishyOne/Phishtopia.com/blob/archive/course-projects-2026-07-28/views/app-brewery-static/9-Prices/preview.png?raw=1) · [View archived source](https://github.com/PhishyOne/Phishtopia.com/tree/archive/course-projects-2026-07-28/views/app-brewery-static/9-Prices)

### Chapter 8 - Agency Website

**Original route:** `/static/8-Agency/`

Given the specs of how the website should be laid out -- using only floats, widths, and block/inline-block displays (no flexbox, grid, or bootstrap) -- I managed to construct their site with a media query to be responsive to display size and stack the content accordingly

[View screenshot](https://github.com/PhishyOne/Phishtopia.com/blob/archive/course-projects-2026-07-28/views/app-brewery-static/8-Agency/assets/images/preview.png?raw=1) · [View archived source](https://github.com/PhishyOne/Phishtopia.com/tree/archive/course-projects-2026-07-28/views/app-brewery-static/8-Agency)

### Chapter 7 - Laos Flag

**Original route:** `/static/7-Flag/`

Following strict guidelines, I solved the puzzle of creating the flag of Laos using only CSS to style divs (boxes). Basically, I sized, positioned, shaped, and colored rectangles before sizing and positioning the text to create the flag.

[View screenshot](https://github.com/PhishyOne/Phishtopia.com/blob/archive/course-projects-2026-07-28/views/app-brewery-static/7-Flag/assets/images/preview.png?raw=1) · [View archived source](https://github.com/PhishyOne/Phishtopia.com/tree/archive/course-projects-2026-07-28/views/app-brewery-static/7-Flag)

### Chapter 6 - Motivational Meme

**Original route:** `/static/6-Meme/`

Using HTML and CSS, I made a classic-style original meme with a custom font, borders, aligned and transformed text, margins, sizing, and a background.

[View screenshot](https://github.com/PhishyOne/Phishtopia.com/blob/archive/course-projects-2026-07-28/views/app-brewery-static/6-Meme/assets/images/preview.png?raw=1) · [View archived source](https://github.com/PhishyOne/Phishtopia.com/tree/archive/course-projects-2026-07-28/views/app-brewery-static/6-Meme)

### Chapter 5 - Colors in Spanish

**Original route:** `/static/5-Spanish-Colors/`

Created a style.css file where I formatted html text color, font weight, and image height & width using class, tag, and element selectors.

[View screenshot](https://github.com/PhishyOne/Phishtopia.com/blob/archive/course-projects-2026-07-28/views/app-brewery-static/5-Spanish-Colors/preview.png?raw=1) · [View archived source](https://github.com/PhishyOne/Phishtopia.com/tree/archive/course-projects-2026-07-28/views/app-brewery-static/5-Spanish-Colors)

### Chapter 4 - This Page!

**Original route:** `/static/4-This-Page/index.html`

Using html, this page showcases my knowledge on referencing images, creating hyperlinks, and structuring a simple webpage.

[View screenshot](https://github.com/PhishyOne/Phishtopia.com/blob/archive/course-projects-2026-07-28/views/app-brewery-static/4-This-Page/preview.png?raw=1) · [View archived source](https://github.com/PhishyOne/Phishtopia.com/tree/archive/course-projects-2026-07-28/views/app-brewery-static/4-This-Page)

### Chapter 3 - Birthday Invite

**Original route:** `/static/3-Birthday/birthday-invite.html`

I learned to insert an image and made an unordered list.

[View screenshot](https://github.com/PhishyOne/Phishtopia.com/blob/archive/course-projects-2026-07-28/views/app-brewery-static/3-Birthday/preview.png?raw=1) · [View archived source](https://github.com/PhishyOne/Phishtopia.com/tree/archive/course-projects-2026-07-28/views/app-brewery-static/3-Birthday)

### Chapter 2 - Movie Rank

**Original route:** `/static/2-Movies/movie-rank.html`

I use different headers and a paragraph element to format my text to different sizes in an orderly fashion.

[View screenshot](https://github.com/PhishyOne/Phishtopia.com/blob/archive/course-projects-2026-07-28/views/app-brewery-static/2-Movies/preview.png?raw=1) · [View archived source](https://github.com/PhishyOne/Phishtopia.com/tree/archive/course-projects-2026-07-28/views/app-brewery-static/2-Movies)
