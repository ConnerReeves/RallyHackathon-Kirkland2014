Ext.define('CustomApp', {
    extend: 'Rally.app.App',
    componentCls: 'app',
    
    layout: 'fit',
    items: [{
        xtype:'tabpanel',
        minTabWidth: 150,
        deferredRender: false,
        items:[{
            title: 'Permissions',
            layout: 'border',
            defaults: {
                layout: 'fit',
                collapsible: false,
                border: false
            },
            items: [{
                title: 'User Selection',
                id: 'userSelectionGridContainer',
                cls: 'borderRight',
                region: 'west',
                width: '50%',
                listeners: {
                    afterrender: function(panel) {
                        panel.header.add({
                            xtype     : 'textfield',
                            emptyText : 'User Search...',
                            width     : 200,
                            margin    : '0 0 0 0',
                            listeners : {
                                change : _.debounce(function(searchBox) {
                                    var searchText = searchBox.getValue();
                                    var grid = Ext.getCmp('userSelectionGrid');
                                    if (grid) {
                                        grid.store.filterBy(function(record) {
                                            return _.contains((record.get('FirstName') + record.get('LastName')).toLowerCase().replace(/ /g, ''), searchText.toLowerCase().replace(/ /g, ''));
                                        });
                                    }
                                }, 250)
                            }
                        });
                    }
                }
            },
            {
                title: 'Project Selection',
                id: 'projectSelectionTreeContainer',
                region: 'center',
                width: '50%',
                header: {
                    height: 29
                }
            },
            {
                region: 'south',
                cls: 'tabBar borderTop',
                height: 28,
                resizable: false,
                layout: 'hbox',
                defaults: {
                    margin: '2 2 0 2'
                },
                items: [{
                    xtype      : 'combobox',
                    id         : 'permissionLevelPicker',
                    store      : ['None', 'Viewer', 'Editor', 'Admin'],
                    value      : 'Viewer',
                    width      : 180,
                    fieldLabel : 'Permission Level',
                    labelWidth : 90,
                    labelAlign : 'right'
                },
                {
                    xtype      : 'checkbox',
                    id         : 'overwritePermissionsPicker',
                    fieldLabel : 'Overwrite Existing Permissions',
                    labelWidth : 160,
                    labelAlign : 'right'
                },
                {
                    xtype      : 'checkbox',
                    id         : 'includeChildProjectsPicker',
                    fieldLabel : 'Include Child Projects',
                    labelWidth : 112,
                    labelAlign : 'right'
                },
                {
                    xtype: 'component',
                    flex: 1
                },
                {
                    xtype: 'button',
                    text: 'Apply',
                    cls: 'active',
                    height: 22,
                    handler: function() {
                        Rally.getApp()._applyPermissions();
                    }
                }]
            }]
        },
        {
            title: 'User Activity',
            id: 'userActivityTab',
            layout: 'fit',
            listeners: {
                resize: function() {
                    Rally.getApp()._resizeCharts();
                }
            }
        }]
    }],
    
    launch: function() {
        Ext.getBody().mask('Loading');
        Deft.Chain.parallel([
            this._addUsersGrid,
            this._addProjectTree
        ], this).then({
            success: function() {
                Ext.getBody().unmask();
                this._addUserActivityChart();
            },
            scope: this
        });
    },
    
    _addUsersGrid: function () {
        var deferred = Ext.create('Deft.Deferred');
        Deft.Chain.pipeline([
            function () {
                var deferred = Ext.create('Deft.Deferred');
                Ext.create('Rally.data.WsapiDataStore', {
                    limit   : Infinity,
                    model   : 'User',
                    fetch   : ['FirstName','LastName','Department','LastLoginDate','Disabled','CreationDate'],
                    filters : [{
                        property: 'ObjectID',
                        operator: '>',
                        value: 0
                    },
                    {
                        property: 'FirstName',
                        operator: '!=',
                        value: null
                    },
                    {
                        property: 'LastName',
                        operator: '!=',
                        value: null
                    }],
                    sorters: [{
                        property: 'FirstName',
                        direction: 'ASC'
                    },
                    {
                        property: 'LastName',
                        direction: 'ASC'
                    }]
                }).load({
                    callback : function(records, operation, success) {
                        deferred.resolve(this);
                    }
                });
                return deferred.promise;
            },
            
            function (store) {
                this.userStore = store;
                
                Ext.getCmp('userSelectionGridContainer').add({
                    xtype: 'rallygrid',
                    id: 'userSelectionGrid',
                    store: this.userStore,
                    columnCfgs: ['FirstName','LastName','Department'],
                    enableEditing: false,
                    showPagingToolbar: false,
                    showRowActionsColumn: false,
                    selModel: Ext.create('Ext.selection.CheckboxModel', {
                        onHeaderClick: function (headerCt, header, e) {
                            e.stopEvent();
                            var me = this;
                            var isChecked = header.el.hasCls(Ext.baseCSSPrefix + 'grid-hd-checker-on');

                            me.preventFocus = true;
                            if (isChecked) {
                                me.deselectAll(true);
                            } else {
                                me.selectAll(true);
                            }
                            delete me.preventFocus;
                        }
                    })
                });
            }
        ], this).then({
            success: function() {
                deferred.resolve();
            }
        });
        return deferred.promise;  
    },

    _addProjectTree: function() {
        var deferred = Ext.create('Deft.Deferred');
        Deft.Chain.pipeline([
            //Get Project Records from WSAPI
            function() {
                var deferred = Ext.create('Deft.Deferred');
                Ext.create('Rally.data.WsapiDataStore', {
                    limit   : Infinity,
                    model   : 'Project',
                    fetch   : ['Parent','Name','ObjectID'],
                    sorters : [{
                        property  : 'Name',
                        direction : 'ASC'
                    }]
                }).load({
                    callback : function(records, operation, success) {
                        deferred.resolve(records);
                    }
                });
                return deferred.promise;
            },

            //Aggregate to tree store
            function(records) {
                //Initialize tree with top level projects
                var treeData = _.map(_.filter(records, function(record) {
                    return record.get('Parent') === null;
                }), function(record) {
                    return {
                        text: record.get('Name'),
                        id: record.get('ObjectID')
                    };
                });

                //Map parent OID to child records
                var parentChildMap = _.groupBy(_.filter(records, function(record) {
                    return record.get('Parent');
                }), function(record) {
                    return record.get('Parent').ObjectID;
                });

                this.populateChildren = function(parentNode) {
                    var childRecords = parentChildMap[parentNode.id];
                    if (childRecords && childRecords.length) {
                        parentNode.children = _.map(childRecords, function(childRecord) {
                            var childNode = {
                                text: childRecord.get('Name'),
                                id: childRecord.get('ObjectID')
                            };

                            this.populateChildren(childNode);

                            return childNode;
                        }, this);
                        parentNode.leaf = false;
                    } else {
                        parentNode.children = [];
                        parentNode.leaf = true;
                    }
                };

                _.each(treeData, function(rootNode) {
                    this.populateChildren(rootNode);
                }, this);

                return treeData;
            },

            function(treeData) {
                Ext.getCmp('projectSelectionTreeContainer').add({
                    xtype         : 'treepanel',
                    id            : 'projectSelectionTree',
                    allowDeselect : true,
                    border        : false,
                    multiSelect   : true,
                    rootVisible   : false,
                    useArrows     : true,
                    store         : Ext.create('Ext.data.TreeStore', {
                        fields : ['children','id','text'],
                        root   : {
                            expanded : true,
                            children : treeData
                        }
                    })
                });
            }
        ], this).then({
            success: function() {
                deferred.resolve();
            }
        });
        return deferred.promise;
    },
    
    _applyPermissions: function() {
        var permissionLevel      = Ext.getCmp('permissionLevelPicker').getValue();
        var overwriteExisting    = Ext.getCmp('overwritePermissionsPicker').checked;
        var includeChildProjects = Ext.getCmp('includeChildProjectsPicker').checked;

        var selectedUserOIDs = _.map(Ext.getCmp('userSelectionGrid').getSelectionModel().getSelection(), function(record) {
            return record.get('ObjectID');
        });

        var selectedProjectOIDs = [];
        _.each(Ext.getCmp('projectSelectionTree').getSelectionModel().getSelection(), function(node) {
            if (includeChildProjects) {
                node.cascadeBy(function(child) {
                    selectedProjectOIDs.push(child.get('id'));
                });
            } else {
                selectedProjectOIDs.push(node.get('id'));
            }
        });   
    

        Deft.Chain.pipeline([
            function() {
                var deferred = Ext.create('Deft.Deferred');
                Ext.create('Rally.data.WsapiDataStore', {
                    limit   : Infinity,
                    model   : 'ProjectPermission',
                    fetch   : ['Role','Project','ObjectID','User'],
                    filters : Rally.data.QueryFilter.or(_.map(selectedUserOIDs, function(userOID) {
                        return {
                            property: 'User.ObjectID',
                            value: userOID
                        };
                    })),
                    listeners : {
                        beforeload : function() {
                            this.getProxy().actionMethods = {
                                read : 'POST'
                            };
                            this.getProxy().timeout = 600000; //10 minute timeout
                        }
                    }
                }).load({
                    callback : function(records, operation, success) {
                        deferred.resolve(_.indexBy(records, function(record) {
                            return record.get('User').ObjectID + '_' + record.get('Project').ObjectID;
                        }));
                    }
                });
                return deferred.promise;
            },

            function(userPermissionsMap) {
                var deferred = Ext.create('Deft.Deferred');
                
                Rally.data.ModelFactory.getModel({
                    type: 'ProjectPermission',
                    success: function(projectPermissionModel) {
                        var recordsToCreate = [];
                        var recordsToDelete = [];

                        _.each(selectedUserOIDs, function(userOID) {
                            _.each(selectedProjectOIDs, function(projectOID) {
                                var recordToUpdate = userPermissionsMap[userOID + '_' + projectOID];
                                if (!recordToUpdate) {
                                    recordsToCreate.push(Ext.create(projectPermissionModel, {
                                        User: '/user/' + userOID,
                                        Project: '/project/' + projectOID,
                                        Role: permissionLevel
                                    }));
                                } else if (permissionLevel === 'None') {
                                    recordsToDelete.push(recordToUpdate);
                                } else if (recordToUpdate.get('Role') !== permissionLevel && overwriteExisting) {
                                    recordsToDelete.push(recordToUpdate);
                                    recordsToCreate.push(Ext.create(projectPermissionModel, {
                                        User: '/user/' + userOID,
                                        Project: '/project/' + projectOID,
                                        Role: permissionLevel
                                    }));
                                }
                            });
                        });
                        deferred.resolve({
                            recordsToCreate : recordsToCreate,
                            recordsToDelete : recordsToDelete
                        });
                    }
                });
                return deferred.promise;
            },

            function(recordSets) {
                if (recordSets.recordsToCreate.length + recordSets.recordsToDelete.length > 0) {
                    this.add({
                        xtype: 'rallydialog',
                        id: 'dialog',
                        autoShow: true,
                        closeAction: 'destroy',
                        width: 500,
                        closable: true,
                        title: 'Updating Permissions...',
                        items: [{
                            xtype: 'progressbar',
                            id: 'updateProgress',
                            value: 0,
                            text: '0%',
                            failCount: 0,
                            totalCount: recordSets.recordsToCreate.length + recordSets.recordsToDelete.length,
                            finishedCount: 0,
                            incrimentCount: function() {
                                var percentRemaining = ++this.finishedCount / this.totalCount;
                                if (percentRemaining >= 1) {
                                    this.updateProgress(1, 'Successful: ' + Ext.util.Format.number((this.totalCount - this.failCount), '0,0') + ' Failed: ' + Ext.util.Format.number(this.failCount, '0,0'));
                                } else {
                                    this.updateProgress(percentRemaining, Math.round(percentRemaining * 100) + '%');
                                }
                            }
                        }],
                        listeners: {
                            close : function(panel) {
                                panel.destroy();
                            }
                        }
                    });

                    Deft.Chain.pipeline([
                        function() {
                            if (recordSets.recordsToDelete.length === 0) {
                                return [];
                            } else {
                                return this._processRecords(recordSets.recordsToDelete, 'destroy');
                            }
                        },
                        function(failedIds) {
                            recordSets.recordsToCreate = _.filter(recordSets.recordsToCreate, function(record) {
                                return !_.contains(failedIds, record.get('User').ObjectID + '_' + record.get('Project').ObjectID);
                            });

                            return this._processRecords(recordSets.recordsToCreate, 'save');
                        }
                    ], this);
                } else {
                    Rally.ui.notify.Notifier.showWarning({
                        message  : 'No permissions to be changed.',
                        duration : 5000
                    });
                }
            }
        ], this);
    },

    _processRecords: function(records, method) {
        var deferred = Ext.create('Deft.Deferred');
        var failedRecords = [];
        Deft.Chain.sequence(_.map(records, function(record) {
            return function() {
                var deferred = Ext.create('Deft.Deferred');
                record[method]({
                    success: function() {
                        var progressBar = Ext.getCmp('updateProgress');
                        if (progressBar) {
                            progressBar.incrimentCount();
                        }
                        deferred.resolve();
                    },
                    failure: function(record, err) {
                        var progressBar = Ext.getCmp('updateProgress');
                        if (progressBar) {
                            progressBar.failCount++;
                            progressBar.incrimentCount();
                        }
                        failedRecords.push(record);
                        deferred.resolve();
                    }
                });
                return deferred.promise;
            };
        })).then({
            success: function() {
                deferred.resolve(_.map(failedRecords, function(record) {
                    return record.get('User').ObjectID + '_' + record.get('Project').ObjectID;
                }));
            }
        });
        return deferred.promise;
    },

    _addUserActivityChart: function() {
        var self = this;

        var departments = _.groupBy(this.userStore.getRecords(), function(record) {
            return record.get('Department');
        });

        var categories = ['Never', '>6 Months', '3-6 Months', '1-3 Months', 'Last Month', 'Last Week'];

        var series = Rally.util.Array.sortByAttribute(_.map(departments, function(records, department) {
            var data = _.range(0, 6, 0);

            _.each(records, function(record) {
                var ageIndex;
                if (record.get('LastLoginDate') === null) {
                    ageIndex = 0;
                } else {
                    var lastLoginAgeInWeeks = Rally.util.DateTime.getDifference(new Date(), record.get('LastLoginDate'), 'week');
                    if (lastLoginAgeInWeeks > 26) ageIndex = 1;
                    if (lastLoginAgeInWeeks > 13 && lastLoginAgeInWeeks <= 26) ageIndex = 2;
                    if (lastLoginAgeInWeeks > 4 && lastLoginAgeInWeeks <= 13) ageIndex = 3;
                    if (lastLoginAgeInWeeks > 1 && lastLoginAgeInWeeks <= 4) ageIndex = 4;
                    if (lastLoginAgeInWeeks <= 1) ageIndex = 5;
                }

                data[ageIndex]++;
                record.set('AgeIndex', ageIndex);
            });

            return {
                name : department,
                data : data
            };
        }), 'name');

        Ext.getCmp('userActivityTab').add({
            xtype: 'rallychart',
            id: 'userActivityChart',
            chartConfig : {
                chart: {
                    type: 'column',
                    events: {
                        load: _.delay(self._resizeCharts, 1000)
                    }
                },
                title: {
                    text: 'Last Login Activity'
                },
                subtitle: {
                    text: 'by Department'
                },
                yAxis: {
                    min: 0,
                    stackLabels: {
                        enabled: true,
                        style: {
                            fontWeight: 'bold'
                        }
                    },
                    title: {
                        text: ''
                    }
                },
                legend: {
                    align: 'center',
                    verticalAlign: 'bottom'
                },
                tooltip: {
                    formatter: function() {
                        return '<b>' + this.series.name + ': '+ this.y +'</b><br/>Total: '+ this.point.stackTotal;
                    }
                },
                plotOptions: {
                    column: {
                        stacking: 'normal',
                        dataLabels: {
                            enabled: true,
                            style: {
                                color : 'black'
                            },
                            formatter: function() {
                                return this.y / this.series.yAxis.dataMax < 0.05 ? '' : this.y;
                            }
                        },
                        events: {
                            click: function(event) {
                                var records = _.filter(self.userStore.getRecords(), function(record) {
                                    return record.get('AgeIndex') === event.point.x;
                                });

                                self._showUserDetail(records, 'User Activity: ' + event.point.category);
                            }
                        }
                    }
                }
            },
            chartData : {
                series     : series,
                categories : categories
            },
            listeners: {
                afterrender: function() {
                    this.unmask();
                }
            }
        });
    },

    _resizeCharts: function() {
        var chart = Ext.getCmp('userActivityChart');
        var tabHeight = Ext.getCmp('userActivityTab').getHeight();
        if (chart && chart.down('highchart')) {
            chart.down('highchart').setHeight(tabHeight);
        }
    },

    _showUserDetail: function(records, title) {
        var self = this;

        Ext.create('Rally.ui.dialog.Dialog', {
            layout     : 'fit',
            autoShow   : true,
            width      : 750,
            height     : Ext.getBody().getHeight() - 250,
            autoScroll : true,
            closable   : true,
            movable    : true,
            title      : title,
            items      : [{
                xtype : 'rallygrid',
                id    : 'userActivityGrid',
                model : 'User',
                store : Ext.create('Ext.data.Store', {
                    fields     : ['FirstName','LastName','Department','LastLoginDate','Disabled','CreationDate'],
                    data       : records,
                    groupField : 'Department',
                    pageSize   : 1000000
                }),
                showPagingToolbar    : false,
                showRowActionsColumn : false,
                features             : [{
                    ftype          : 'groupingsummary',
                    groupHeaderTpl : '{name} ({rows.length} User{[values.rows.length > 1 ? "s" : ""]})'
                }],
                columnCfgs: [{
                    dataIndex : 'FirstName',
                    text: 'First Name',
                    flex: 1
                },{
                    dataIndex : 'LastName',
                    text: 'Last Name',
                    flex: 1
                },{
                    dataIndex : 'LastLoginDate',
                    text: 'Last Login',
                    width : 80,
                    align: 'center',
                    renderer: function(val) {
                        return Ext.util.Format.date(val, 'Y-m-d') || 'N/A';
                    }
                },{
                    dataIndex : 'CreationDate',
                    text: 'Created',
                    width : 80,
                    align: 'center',
                    renderer: function(val) {
                        return Ext.util.Format.date(val, 'Y-m-d') || 'N/A';
                    }
                },{
                    dataIndex : 'Disabled',
                    text: 'Disabled',
                    width : 80,
                    align: 'center',
                    renderer: function(val) {
                        return val ? '<span class="icon-check"></span>' : '';
                    }
                }],
                selModel: Ext.create('Ext.selection.CheckboxModel', {
                    onHeaderClick: function (headerCt, header, e) {
                        e.stopEvent();
                        var me = this;
                        var isChecked = header.el.hasCls(Ext.baseCSSPrefix + 'grid-hd-checker-on');

                        me.preventFocus = true;
                        if (isChecked) {
                            me.deselectAll(true);
                        } else {
                            me.selectAll(true);
                        }
                        delete me.preventFocus;
                    }
                })
            }],
            listeners: {
                afterrender: function() {
                    this.header.add(1, [{
                        xtype   : 'exportbutton',
                        gridId  : 'userActivityGrid',
                        margins : '0 5 0 0'
                    },{
                        xtype   : 'button',
                        text    : 'Disable Selected',
                        handler : function() {
                            var grid          = Ext.getCmp('userActivityGrid');
                            var selModel      = grid.getSelectionModel();
                            var selectedUsers = selModel.getSelection();
                            self._editUserDisabledSetting(selectedUsers, true, grid);
                        }
                    },{
                        xtype   : 'button',
                        text    : 'Enable Selected',
                        handler : function() {
                            var grid          = Ext.getCmp('userActivityGrid');
                            var selModel      = grid.getSelectionModel();
                            var selectedUsers = selModel.getSelection();
                            self._editUserDisabledSetting(selectedUsers, false, grid);
                        }
                    }]);
                }
            }
        });
    },

    _editUserDisabledSetting: function(records, disable, grid) {
        grid.setLoading('Loading');
        Rally.data.BulkRecordUpdater.updateRecords({
            records: records,
            propertiesToUpdate: {
                Disabled : disable
            },
            success: function() {
                grid.setLoading(false);
                Rally.ui.notify.Notifier.show({
                    message  : 'Users successfully ' + (disable ? 'disabled' : 'enabled') + '.',
                    duration : 5000
                });
            },
            failure: function() {
                grid.setLoading(false);
                Rally.ui.notify.Notifier.show({
                    message  : 'An error occured while updating.',
                    duration : 1000
                });
            }
        });
    }
});