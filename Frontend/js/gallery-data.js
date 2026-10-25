/**
 * gallery-data.js — the trips shown on the Gallery page (gallery.html).
 *
 * EDIT THIS FILE to add trips or photos. Keep the list NEWEST FIRST.
 *
 *   location     Heading shown for the trip
 *   dates        Date range, shown under the heading
 *   folder       Folder name under images/activities/ (start it with YYYY-MM;
 *                the month and year in the photo alt text come from it)
 *   photos       Number of photos. The page loads 01.jpg, 02.jpg, ... up to this number.
 *                Use 0 to show a "Photos coming soon" box.
 *   description  Optional. Shown under the dates when filled in; leave '' to hide.
 *
 * To add a photo: put the next numbered file (e.g. 06.jpg) in the trip's folder
 * and increase `photos` by one.
 */
const GALLERY_TRIPS = [
    {
        location: 'Marinduque',
        dates: 'June 6–11, 2026',
        folder: '2026-06-marinduque',
        photos: 5,
        description: ''
    },
    {
        location: 'Batangas',
        dates: 'March 25–30, 2026',
        folder: '2026-03-batangas',
        photos: 5,
        description: ''
    },
    {
        location: 'Marinduque',
        dates: 'December 11–20, 2025',
        folder: '2025-12-marinduque',
        photos: 3,
        description: ''
    },
    {
        location: 'Marinduque',
        dates: 'June 19–29, 2025',
        folder: '2025-06-marinduque',
        photos: 0,
        description: ''
    }
];
