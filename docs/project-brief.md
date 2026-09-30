# Original project brief and assistant provenance

This source-only file preserves the original project request below. It is not bundled in the application. The visible `&#x20;` entities are retained as they appeared in the provided request.

- Project: OpenPOS
- Initial implementation date: September 30, 2026
- Assistant identity supplied in the conversation: **Codex, an agent based on GPT-6**
- Exact deployed model identifier/version: **not exposed in this session**; no more specific number is asserted.
- License requested / repository license: **Apache License 2.0**
- Decisions and interpretations: [Implementation notes](implementation.html)
- Requirement mapping: [Acceptance map](acceptance.html)

## Original request (verbatim)

```text
I've started a completely new project in an absolutely blank repository. The only thing I have is the readme and the apache 2.0 license. The idea is that I am going to vibe code this entire project. I will give you a list of instructions broken apart into different conceptual sections (eg "Basics", "Configuration", "Customization") along with acceptance criteria for each section that will follow these initial context defining messages.&#x20;

The goal of this project is to create a customizable POS software that can be downloaded as a standalone application onto windows devices. The main target client is small businesses or restaurants, especially small ma-and-pap pizza joints that mainly offer delivery and takeout options. But the application should be scalable and configurable such that it should work for larger business and restaurants as well. In a restaurant setting, it might be common that the application is loaded onto a windows tablet like device, so make sure that taps not just clicks work as user input.&#x20;

Technology stack:
Technology stack is as follows, for anything that is missing feel free to choose technologies at your own discretion or packages that fit well with this technology stack. I may or may not have these technologies already installed on my machine, so feel free to yarn install the packages you require to this environment during your development of the application. &#x20;
Installer: NSIS
Packaging: Webpack
Language: Typescript
FrontEnd: React
FrontEndIcons: Use MDI icons where available, and generate icon images for anything thats not available
Data: JSON
Logs: NDJSON
Framework: Electron
Package control: Yarn

Vibe:&#x20;
The application should feel modern and sleek, but not necessarily "fancy". People will be interacting with this software during their day-to-day lives while accomplishing their job goals (waiters, phone takeout answering, dedicated cashier ... etc) - so the application interface doesn't necessarily need to drive user engagement but it should be easy on the eyes, functional, easily understood and explainable. As you develop the application, try your best to use any standard icons and windows but generate any artistic assets you may need as you progress.&#x20;
You should consider generating a logo for the application icon, as well as if there is a loading screen while the electron application is loading (you may wish to include the icon there along with a spinner icon)&#x20;

Testing:&#x20;
A) As you build new features, make sure to create unit tests that cover the new features. Periodically test existing features and update/modify the test suite as the features progress.&#x20;
B) for the sake of testing - you should provide some dummy data to the application for development and testing purposes. when i launch the application on my machine i want to see all of the features - so that means log some orders in progress, log some that are completed, make some dummy menu items and use some of the optional parameters like inventory. you should also include some inventory like its been added by the owner of the business.&#x20;
C) for now - the dummy data should cover both use cases of like a corner store but also a pizza shop. so - really it should reflect a pizza shop but make sure you also have more basic items like "snickers bar", "canned pepsi" etc that would reflect more of the corner store business use case as well for testing purposes of more basic items that aren't reflective of a restaurant style approach.&#x20;

Master & Client:&#x20;
A) typically the master application would be installed beside the cash register or by the phone where orders are taken. As orders are created - it should broadcast to any registered locations so that the backend data is propagated to any registered clients.&#x20;
B) a client application would be installed in the back of the shop - perhaps by the chef where the food is getting made. They would typically just keep the application open to the "Orders" view/tab whereas the Master application would typically keep open to the "Menu items/Take orders" tab. As orders are generated on the master application - they will appear on the client application.&#x20;
C) as the client application selects "completed" on the orders option - this data should be sent back to the master application and all data should be kept in sync from these operations.&#x20;

Basics:&#x20;
A) the application should launch to a window where the menu options are available so that someone whos on the phone taking an order from a customer can quickly tap/click the menu option being chosen from the customer
B) menu items can have size/type distinctions or just be base units. For example a client may wish to configure tree menu items "Large Coke", "Medium Coke", "Small Coke" or they may wish to configure one menu item "Coke" with three size distinctions "Large/Medium/Small".&#x20;
C) menu items (and their various size/type distinctions will obviously have a cost associated with them on the backend that will be tallied as the order is being created
D) the application will be split vertically into different sections. the menu options will be available in a large pane on the left and on the right side there will be a smaller vertical section where the current order is being generated and the current total is being added together
E) as the order is created, the total cost (including tax - see below configuration section item B)) and any fees (see below configuration section item C)) are tallied together to create the running total of the item
F) where possible and applicable, components all across the application should provide helpful tooltips to help guide a new user
G) in the bottom of the right panel (the order section) there will be a button called "Order" - this will generate the order and receipt. The order should be logged in the system to a data file.&#x20;

Orders:&#x20;
A) the orders screen should be a "tab" on the main screen. So in addition to the "Menu Items" view there will be an "Orders" view - here is the list of all orders.&#x20;
B) the order screen should be split into two sections - in progress & completed. In progress orders should have a button beside them called "Completed" - once this is hit it should be added to the completed section and the backend data updated.&#x20;
C) on the Orders tab, each order should be able to be edited incase for example the customer calls back or the employee made a mistake while logging the order. when the employee edits an order (in progress or completed) the cost is updated accordingly

Menu Items:&#x20;
A) on the main tab where the user can see all the menu items - each menu item should be editable (via perhaps a pencil icon). Clicking this icon will launch the "add menu item dialog" (same as the toolbar) but this time with the menu items information already prepopulated. as they make edits or additions in this dialog and click save the data should be propogated to the backend json data and any registered client machines.&#x20;

Inventory:&#x20;
A) Inventory should be an optional feature, where for each menu item, the associated inventory item(s) can be deducted from the backend inventory data. In a basic case - for example the business might have logged 10 available snickers bars. when a customer orders one snickers bar - and the order is completed;
B) from the toolbar of the application there should be an inventory dialog available to pop up. This dialog should allow the administrator to select from a list of items and add amounts purchased. For example they may wish to add "Beef Burgers", "12". When an order for a burger comes in, when that menu item was created it would have been configured to consume "1" "Beef Burger". Make sure that this inventory draw-down feature is added as an optional section in the add menu item dialog.&#x20;

Audit:&#x20;
A) Audit should be another tab available in the main window of the application which consumes all of the data files and has information about the sales.&#x20;
B) the timeline should be configurable by date - eg the user may wish to look at all the sales for today, last month or some other customizable timeline.&#x20;
C) the main breakdown should be about gross income, but should also include details about any inventory draw down (if that feature is being leveraged) as well as details about how many orders of different menu items happened in a list filtered by frequency of purchases or income generated (toggled by user)

Configuration:&#x20;
A) in the toolbar of the application, there should be a configuration menu, which pops up an additional dialog. here the administrator can easily configure things like -
B) tax rate applied to orders
C) a customizable list of "fees" added to orders (where the administrator can add/remove/modify existing fee options). For example there may be an additional 1.50 fee for sitting on the patio or poolside, or there may be 2.00 surcharge for delivery. The administrator is able to set the name, and cost of any fees and these fees will appear in a special section of the menu items as a distinct component of the receipt
D) "Auto Complete Orders" - in the context of a corner store for example - (like buying a snickers bar and a pop can) there is no order preparation phase. Businesses may wish to circumvent this whole feature by toggling this option on - when this option is on orders are automatically sent to the completed orders section circumventing the "in progress" section - and inventory is automatically deducted.&#x20;
E) make sure the configuration dialog has basic input validation (don't allow words in the tax field for example, it should be a number value that is used as a percentage on the backend)
F) any other configurable fields you deem necessary or useful that you uncover during development that I may have missed to call out explicitly.&#x20;
G) register any client machines that data should be propogated to and from (or the ability to turn this feature off completely in the case that there will only be one machine running inside the business)

Customization:&#x20;
A) in the toolbar of the application, there should be an "insert menu item" option. this will open a dialog and query the user for the mandatory and optional arguments that are required to define a new menu option for the application. In this dialog they can set name, price, and size/type distinctions. Saving this menu item will populate the record to the backend data as an entry into a json file
B) the application reads from this json file to populate the menu item screen - make sure to cover the case where the user uses the insert item dialog - the menu item should appear automatically on the front end without having to restart/refresh the application window itself

Backend data:&#x20;
A) the menu items will be stored in a json file, with an entry storing all of the various mandatory and optional arguments that define the menu item
B) a power user may wish to create or edit this json file manually as well, so make sure that the front end can refresh when this json file is edited manually in the filesystem as well
C) inventory data can be in a separate json file
D) orders can be kept in a separate json file
E) any other data that you think needs to be stored that i may have missed to call out explicitly. use logical reasoning to determine if the data should be stored in an existing json file or it should be separated into its own file.&#x20;

Installation:&#x20;
A) the installation should make a start menu icon and icon on the desktop that launches the application
B) the installation should create a .openpos folder in the users folder where any data files
C) the installation should be installed per-machine (NSIS option)
D) the installation may need to distinguish between master/client machines, but i think in reality all machines can install the same flavour of application and they can all communicate to each other. there shouldn't be anything stopping the kitchen staff from modifying an order on their screen for example - but this data still needs to be propgated back to all the other registered machines as well, along with any other actions that modify the program data.&#x20;
E) however, certain installations may have certain features toggled on/off via an administrator password. for example, the Audit tab shouldn't be available to the workers in the back. but the owner should be able to view the audit tab on their installation via entering the password in their configuration dialog, which will enable this feature on their end.&#x20;

Environment
A) dont worry too much right now about what specific flavours or version of windows the application will work on - feel free to make assumptions about this for now - but it should work on at least Windows version 10 (64 bit machines) and newer.&#x20;

Documentation
A) update the readme with project download steps from a developer perspective. also include some configuration/customization details as well as a "quick start/setup section" (available in the source repo not the application)
B) in the application toolbar, there should be an option to open up a help document, ideally in a stylized html format that will open in the users default web browser outside of the application window - the help document should be written for the end-user and business persons perspective. This should provide detailed steps about how to use the features of the application, how to configure new menu items (either through the dialog or the json file) along with how to interact with any of the other features implemented (eg setting tax rate in the configuration menu) - this documentation is explicitly intended to be included in the application for end-users/customers.&#x20;
C) as you build the application - i want you to document an architectural diagram that gives a high level overview of how different pieces of the application interact and are interconnected - ideally in a stylized html file available in the source repo (not available in the application)
D) as you build the application, keep detailed information about any implementation decisions and document this in a stylized html file in the source repo (not available in the application)
E) document this prompt along with your model number/name in the source repo (not available in the application)
F) document anything else you think might be applicable or useful that i may not have called out explicitly.&#x20;

Sales
A) provide a sales document/section in the readme that quickly highlights all of the strong "selling points/features" that the application has to offer.&#x20;
B) this should be a quick read, with visual elements designed for a non technical audience

Review
A) review the provided AC's and features - if you spot an obvious feature that should have been implemented feel free to take the liberty to do so (as long as it doesn't explicitly conflict with any given acceptance criteria)
B) review for any existing conflicts in provided acceptance criteria and do your best to determine the correct path of implementation and document your choices as mentioned above in the documentation section
C) take the liberty to build the application as you see fit without worrying about re-querying me for additional input, suggestions or clarifications as long as you document your choices along the way.&#x20;

Take as long as you need, use as many tokens as you need, perform as much testing and re-iterations as required. Leave no stone unturned during your implementation of the above features and acceptance criteria, and document any assumptions and design decisions generated along the way. Lets see what you can come up with!&#x20;

Any further prompts in this chat should follow the above acceptance criteria as well, unless specific conflicts or objections arise (for example updating the help documentation, updating the architectural diagram, updating the implementation notes .. etc)
```
